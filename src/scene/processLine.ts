import * as THREE from "three";
import type { Process, ProcessStop, StopState } from "../model/processes/line";
import { isLimbRoute, pointAlong, RouteNetwork, Strand, traceStrands } from "./routes";
import {
  BeadUniforms,
  createBeadMaterial,
  createLineMaterial,
  LineUniforms,
  MAX_LINE_SEGMENTS,
  Palette,
} from "./materials";

const LINE = {
  weightPx: 1.5, // one weight everywhere: colour says where things are, and the panel says how much
  jumpWeightPx: 1,
  spotlightWeight: 1.3,
  alpha: { passed: 0.55, here: 1, ahead: 0.26 } satisfies Record<StopState, number>,
  jumpAlpha: 0.4, // of the above, for a jump with no route under it
  throughOrganAlpha: 0.5,
  unlitAlpha: 0.48,
  drawSeconds: 0.75,
  easeRate: 7,
  fadeRate: 11,
  shortest: 0.002, // a stretch shorter than this, in metres, draws no line
};

const BEADS = {
  most: 5,
  leastFlow: 0.02,
  leastSpacing: 0.05, // metres between beads on one stretch
  metresPerSecond: 0.03,
  flowSpeedGain: 0.5,
  sizePx: 5,
  endFade: 0.08, // of a stretch, so a bead wrapping round is never seen to jump
  fadeRate: 5,
  throughOrganAlpha: 0.6,
};

const STATION = { sizePx: { here: 6, other: 4 }, alphaGain: 1.5 };

const FIRST_CAPACITY = 2048; // points along the line

// All sizes above are in the interface's unit, so the line keeps its weight against the panels on a large display.

export type StopLocator = (stop: ProcessStop, process: Process, out: THREE.Vector3) => THREE.Vector3;

// After muscles, so a line stays on top of a faint muscle it enters; before the skin at 50.
const ORDER = { lineThrough: 46, line: 47, beadsThrough: 48, beads: 49 };

interface Stretch {
  stopId: string;
  strands: Strand[];
  total: number; // to the far end of its longest strand
  anchor: THREE.Vector3;
  usesLimbs: boolean;
  jump: boolean; // nothing runs between this stop and the last, so it is only a quiet bow
  width: number;
  alpha: number;
  accent: number;
}

interface Bead {
  stretch: number; // -1 when free
  strand: number;
  u: number;
  alpha: number;
  leaving: boolean;
}

function structureKey(process: Process) {
  return `${process.id}#${process.stops.map((s) => `${s.id}<${s.from ?? ""}<${s.organ ?? ""}<${s.routes.join(",")}`).join("|")}`;
}

// Muscle and fat have no vessel of their own, so a line out to them would be a long straight stroke pretending to be
// one. It goes as a quiet bow instead, unless its way runs down a limb's real artery.
const isOffVessels = (stop: ProcessStop) =>
  stop.muscle !== null || ((stop.organ === "muscle" || stop.organ === "fat") && !stop.routes.some(isLimbRoute));

const weightOf = (jump: boolean) => (jump ? LINE.jumpWeightPx : LINE.weightPx);
const alphaOf = (stop: ProcessStop, jump: boolean) => LINE.alpha[stop.state] * (jump ? LINE.jumpAlpha : 1);

// The selected process as a line laid into the anatomy, one stretch per stop, with a few slow beads
// showing which way things are moving. Only stretches with flow carry beads.
export class ProcessLine {
  readonly group = new THREE.Group();
  readonly bounds = new THREE.Box3(); // of the line being asked for, in the torso's space
  private stretches: Stretch[] = [];
  private shown: Process | null = null;
  private shownKey: string | null = null;
  private planned: Stretch[] = [];
  private plannedKey: string | null = null;
  private keyedProcess: Process | null = null;
  private limbVersion = -1;
  private beadsFor: Process | null = null;
  private beadsDirty = false;
  private master = 0;
  private drawClock = 0;
  private sizeScale = 1;

  private readonly ribbon = new THREE.BufferGeometry();
  private capacity = 0;
  private readonly segmentUniforms = Array.from({ length: MAX_LINE_SEGMENTS }, () => new THREE.Vector3());
  private readonly accentUniforms = new Float32Array(MAX_LINE_SEGMENTS);
  private readonly lineShared: LineUniforms = {
    segments: { value: this.segmentUniforms },
    accents: { value: this.accentUniforms },
    ink: { value: new THREE.Color() },
    accent: { value: new THREE.Color() },
  };
  private readonly beadShared: BeadUniforms;
  private readonly points = new THREE.BufferGeometry();
  private readonly pointPosition = new Float32Array((BEADS.most + MAX_LINE_SEGMENTS) * 3);
  private readonly pointSize = new Float32Array(BEADS.most + MAX_LINE_SEGMENTS);
  private readonly pointAlpha = new Float32Array(BEADS.most + MAX_LINE_SEGMENTS);
  private readonly pointAccent = new Float32Array(BEADS.most + MAX_LINE_SEGMENTS);
  private readonly beads: Bead[] = Array.from({ length: BEADS.most }, () => ({
    stretch: -1,
    strand: 0,
    u: 0,
    alpha: 0,
    leaving: false,
  }));
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly network: RouteNetwork,
    private readonly locate: StopLocator,
    resolution: THREE.Vector2,
    private readonly pixelRatio: number,
  ) {
    this.beadShared = {
      ink: this.lineShared.ink,
      accent: this.lineShared.accent,
      ring: { value: new THREE.Color() },
      pixelRatio: { value: pixelRatio },
    };
    this.growRibbon(FIRST_CAPACITY);
    const addLine = (depthFunc: THREE.DepthModes, depthAlpha: number, renderOrder: number) => {
      const material = createLineMaterial(this.lineShared, resolution, depthFunc, depthAlpha);
      const mesh = new THREE.Mesh(this.ribbon, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      this.group.add(mesh);
    };
    addLine(THREE.GreaterDepth, LINE.throughOrganAlpha, ORDER.lineThrough);
    addLine(THREE.LessEqualDepth, 1, ORDER.line);

    this.points.setAttribute("position", new THREE.BufferAttribute(this.pointPosition, 3));
    this.points.setAttribute("aSize", new THREE.BufferAttribute(this.pointSize, 1));
    this.points.setAttribute("aAlpha", new THREE.BufferAttribute(this.pointAlpha, 1));
    this.points.setAttribute("aAccent", new THREE.BufferAttribute(this.pointAccent, 1));
    const addPoints = (depthFunc: THREE.DepthModes, depthAlpha: number, renderOrder: number) => {
      const material = createBeadMaterial(this.beadShared, depthFunc, depthAlpha);
      const points = new THREE.Points(this.points, material);
      points.frustumCulled = false;
      points.renderOrder = renderOrder;
      this.group.add(points);
    };
    addPoints(THREE.GreaterDepth, BEADS.throughOrganAlpha, ORDER.beadsThrough);
    addPoints(THREE.LessEqualDepth, 1, ORDER.beads);
    this.group.visible = false;
  }

  setSizeScale(scale: number) {
    this.sizeScale = scale;
    this.beadShared.pixelRatio.value = this.pixelRatio * scale;
  }

  setPalette(palette: Palette) {
    this.beadShared.ring.value.set(palette.background);
    this.lineShared.ink.value.set(palette.ink);
  }

  setAccent(color: THREE.Color) {
    this.lineShared.accent.value.copy(color);
  }

  update(dt: number, process: Process | null, spotlight: number | null, motion: boolean) {
    this.syncPlan(process);
    if (this.plannedKey !== this.shownKey) {
      const sameProcess = process !== null && this.shown !== null && process.id === this.shown.id;
      if (this.shown === null || sameProcess || this.master < 0.02) this.commit(process, sameProcess);
    }
    if (process && this.shown && process.id === this.shown.id) this.shown = process;

    const wanted = this.shown && this.plannedKey === this.shownKey ? 1 : 0;
    this.master += (wanted - this.master) * (1 - Math.exp(-dt * LINE.fadeRate));
    const shown = this.shown;
    this.group.visible = shown !== null && this.master > 0.005;
    if (!shown) return;

    this.drawClock += dt;
    const drawn = motion ? Math.min(1, this.drawClock / LINE.drawSeconds) : 1;
    const eased = 1 - Math.exp(-dt * LINE.easeRate);
    const count = this.stretches.length;
    this.stretches.forEach((stretch, i) => {
      const stop = shown.stops.find((s) => s.id === stretch.stopId);
      if (!stop) return;
      const lit = spotlight === null || stop.number === spotlight;
      const width = weightOf(stretch.jump) * (spotlight !== null && lit ? LINE.spotlightWeight : 1);
      const alpha = alphaOf(stop, stretch.jump) * (lit ? 1 : LINE.unlitAlpha);
      // The current stretch is the only one in colour: the one in the spotlight, or else where things are now.
      const accent = (spotlight === null ? stop.state === "here" : stop.number === spotlight) && !stretch.jump ? 1 : 0;
      stretch.width += (width - stretch.width) * eased;
      stretch.alpha += (alpha - stretch.alpha) * eased;
      stretch.accent += (accent - stretch.accent) * eased;
      this.accentUniforms[i] = stretch.accent;
      const revealed = THREE.MathUtils.clamp(drawn * count - i, 0, 1) * stretch.total;
      this.segmentUniforms[i].set(stretch.width * this.sizeScale, stretch.alpha * this.master, revealed);
    });

    if (this.beadsFor !== shown || this.beadsDirty) {
      this.beadsFor = shown;
      this.beadsDirty = false;
      this.assignBeads(shown);
    }
    this.writePoints(shown, dt, motion, spotlight);
  }

  private syncPlan(process: Process | null) {
    if (process !== this.keyedProcess || process === null) {
      this.keyedProcess = process;
      const key = process ? structureKey(process) : null;
      if (key !== this.plannedKey) {
        this.plan(process, key);
        return;
      }
    }
    if (process && this.network.limbVersion !== this.limbVersion && this.plannedKey === this.shownKey) {
      this.limbVersion = this.network.limbVersion;
      this.followPose(process);
    }
  }

  private plan(process: Process | null, key: string | null) {
    this.plannedKey = key;
    this.planned = process ? this.trace(process) : [];
    this.limbVersion = this.network.limbVersion;
    this.bounds.makeEmpty();
    for (const stretch of this.planned) {
      this.bounds.expandByPoint(stretch.anchor);
      for (const strand of stretch.strands) for (const point of strand.path) this.bounds.expandByPoint(point);
    }
  }

  private trace(process: Process): Stretch[] {
    const ends = new Map<string, THREE.Vector3>();
    let previous: THREE.Vector3 | null = null;
    // What a muscle did and what followed is a list of things, not a journey down vessels, and the aorta
    // looping behind a lit muscle only reads as a stray mark.
    const aboutMuscles = process.stops.some((stop) => stop.muscle !== null);
    return process.stops.slice(0, MAX_LINE_SEGMENTS).map((stop, index): Stretch => {
      const anchor = this.locate(stop, process, new THREE.Vector3());
      const origin: THREE.Vector3 | null = (stop.from ? ends.get(stop.from) : undefined) ?? previous;
      const leaving = process.stops.find((s) => s.id === stop.from) ?? process.stops[index - 1];
      const jump =
        aboutMuscles || !stop.routes.length || isOffVessels(stop) || (leaving !== undefined && isOffVessels(leaving));
      const strands = traceStrands(this.network, jump ? [] : stop.routes, origin, anchor);
      ends.set(stop.id, anchor);
      previous = anchor;
      return {
        stopId: stop.id,
        strands,
        total: strands.reduce((longest, strand) => Math.max(longest, strand.startsAt + strand.total), 0),
        anchor,
        usesLimbs: stop.routes.some(isLimbRoute),
        jump,
        width: weightOf(jump),
        alpha: alphaOf(stop, jump),
        accent: stop.state === "here" ? 1 : 0,
      };
    });
  }

  // Posture moves the limbs and anything anchored to them, and nothing else on the line.
  private followPose(process: Process) {
    const moved = this.stretches.some((stretch) => {
      if (stretch.usesLimbs) return true;
      const stop = process.stops.find((s) => s.id === stretch.stopId);
      return stop !== undefined && this.locate(stop, process, this.tmp).distanceToSquared(stretch.anchor) > 1e-6;
    });
    if (!moved) return;
    const before = new Map(this.stretches.map((s) => [s.stopId, s]));
    this.plan(process, this.plannedKey);
    this.stretches = this.planned;
    for (const stretch of this.stretches) {
      const was = before.get(stretch.stopId);
      if (was) {
        stretch.width = was.width;
        stretch.alpha = was.alpha;
      }
    }
    this.writeRibbon();
  }

  private commit(process: Process | null, sameProcess: boolean) {
    const before = new Map(this.stretches.map((s) => [s.stopId, s]));
    this.stretches = this.planned;
    this.shown = process;
    this.shownKey = this.plannedKey;
    if (sameProcess) {
      for (const stretch of this.stretches) {
        const was = before.get(stretch.stopId);
        if (was) {
          stretch.width = was.width;
          stretch.alpha = was.alpha;
          stretch.accent = was.accent;
        }
      }
    } else {
      this.drawClock = 0;
      this.master = 0;
    }
    for (const bead of this.beads) {
      bead.stretch = -1;
      bead.leaving = false;
      bead.alpha = 0;
    }
    this.beadsDirty = true;
    this.writeRibbon();
  }

  private growRibbon(points: number) {
    this.capacity = points;
    const vertices = points * 2;
    this.ribbon.dispose();
    this.ribbon.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
    this.ribbon.setAttribute("aPrev", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
    this.ribbon.setAttribute("aNext", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
    this.ribbon.setAttribute("aSide", new THREE.BufferAttribute(new Float32Array(vertices), 1));
    this.ribbon.setAttribute("aAlong", new THREE.BufferAttribute(new Float32Array(vertices), 1));
    this.ribbon.setAttribute("aSegment", new THREE.BufferAttribute(new Float32Array(vertices), 1));
    this.ribbon.setIndex(new THREE.BufferAttribute(new Uint32Array(points * 6), 1));
  }

  private writeRibbon() {
    const needed = this.stretches.reduce(
      (sum, stretch) => sum + stretch.strands.reduce((points, strand) => points + strand.path.length, 0),
      0,
    );
    if (needed > this.capacity) this.growRibbon(Math.ceil(needed * 1.5));
    const { position, aPrev, aNext, aSide, aAlong, aSegment } = this.ribbon.attributes;
    const index = this.ribbon.getIndex();
    if (!index) throw new Error("The line's ribbon has no index");
    let vertex = 0;
    let written = 0;
    this.stretches.forEach((stretch, stretchIndex) => {
      for (const { path, lengths, total, startsAt } of stretch.strands) {
        if (total < LINE.shortest) continue;
        const base = vertex;
        for (let j = 0; j < path.length; j++) {
          const point = path[j];
          const prev = path[Math.max(0, j - 1)];
          const next = path[Math.min(path.length - 1, j + 1)];
          for (const side of [-1, 1]) {
            position.setXYZ(vertex, point.x, point.y, point.z);
            aPrev.setXYZ(vertex, prev.x, prev.y, prev.z);
            aNext.setXYZ(vertex, next.x, next.y, next.z);
            aSide.setX(vertex, side);
            aAlong.setX(vertex, startsAt + lengths[j]);
            aSegment.setX(vertex, stretchIndex);
            vertex++;
          }
        }
        for (let j = 0; j < path.length - 1; j++) {
          const a = base + j * 2;
          index.setX(written++, a);
          index.setX(written++, a + 1);
          index.setX(written++, a + 2);
          index.setX(written++, a + 2);
          index.setX(written++, a + 1);
          index.setX(written++, a + 3);
        }
      }
    });
    this.ribbon.setDrawRange(0, written);
    for (const attribute of [position, aPrev, aNext, aSide, aAlong, aSegment]) attribute.needsUpdate = true;
    index.needsUpdate = true;
  }

  // Beads run only on the current stretch, evenly along it, and only while something is moving there.
  private beadCounts(process: Process) {
    return this.stretches.map((stretch) => {
      const stop = process.stops.find((s) => s.id === stretch.stopId);
      if (!stop || stop.state !== "here" || stretch.jump || stop.flow < BEADS.leastFlow) return 0;
      return Math.min(BEADS.most, Math.floor(stretch.total / BEADS.leastSpacing));
    });
  }

  private assignBeads(process: Process) {
    const counts = this.beadCounts(process);
    counts.forEach((count, stretch) => {
      const mine = this.beads.filter((b) => b.stretch === stretch && !b.leaving);
      for (const extra of mine.slice(count)) extra.leaving = true;
      const strands = this.stretches[stretch].strands.length;
      for (let have = mine.length; have < count; have++) {
        const free = this.beads.find((b) => b.stretch < 0);
        if (!free) return;
        free.stretch = stretch;
        free.strand = have % strands;
        free.u = this.widestGap(mine.filter((b) => b.strand === free.strand));
        free.alpha = 0;
        mine.push(free);
      }
    });
  }

  private widestGap(beads: Bead[]) {
    if (beads.length === 0) return 0.5;
    const sorted = beads.map((b) => b.u).sort((a, b) => a - b);
    let at = 0;
    let widest = -1;
    sorted.forEach((u, i) => {
      const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 1;
      if (next - u > widest) {
        widest = next - u;
        at = (u + widest / 2) % 1;
      }
    });
    return at;
  }

  private writePoints(process: Process, dt: number, motion: boolean, spotlight: number | null) {
    let n = 0;
    const put = (at: THREE.Vector3, size: number, alpha: number, accent: number) => {
      this.pointPosition[n * 3] = at.x;
      this.pointPosition[n * 3 + 1] = at.y;
      this.pointPosition[n * 3 + 2] = at.z;
      this.pointSize[n] = size;
      this.pointAlpha[n] = alpha;
      this.pointAccent[n] = accent;
      n++;
    };

    this.stretches.forEach((stretch, i) => {
      const stop = process.stops.find((s) => s.id === stretch.stopId);
      if (!stop) return;
      const revealed = this.segmentUniforms[i].z;
      const arrived = stretch.total < LINE.shortest ? 1 : THREE.MathUtils.smoothstep(revealed / stretch.total, 0.92, 1);
      const here = stop.state === "here" || stop.number === spotlight;
      put(
        stretch.anchor,
        here ? STATION.sizePx.here : STATION.sizePx.other,
        Math.min(1, stretch.alpha * STATION.alphaGain) * arrived * this.master,
        here ? 1 : 0,
      );
    });

    const fade = 1 - Math.exp(-dt * BEADS.fadeRate);
    for (const bead of this.beads) {
      if (bead.stretch < 0) continue;
      const stretch = this.stretches[bead.stretch];
      const stop = process.stops.find((s) => s.id === stretch.stopId);
      if (!stop) continue;
      bead.alpha += ((bead.leaving ? 0 : 1) - bead.alpha) * fade;
      if (bead.leaving && bead.alpha < 0.02) {
        bead.stretch = -1;
        bead.leaving = false;
        this.beadsDirty = true;
        continue;
      }
      const strand = stretch.strands[bead.strand];
      if (strand.total < BEADS.leastSpacing) continue;
      if (motion)
        bead.u = (bead.u + (dt * BEADS.metresPerSecond * (1 + BEADS.flowSpeedGain * stop.flow)) / strand.total) % 1;
      const along = bead.u * strand.total;
      const inView = strand.startsAt + along <= this.segmentUniforms[bead.stretch].z ? 1 : 0;
      const ends =
        THREE.MathUtils.smoothstep(bead.u, 0, BEADS.endFade) *
        (1 - THREE.MathUtils.smoothstep(bead.u, 1 - BEADS.endFade, 1));
      put(
        pointAlong(strand.path, strand.lengths, along, this.tmp),
        BEADS.sizePx,
        bead.alpha * ends * inView * this.master,
        1,
      );
    }

    this.points.setDrawRange(0, n);
    this.points.attributes.position.needsUpdate = true;
    this.points.attributes.aSize.needsUpdate = true;
    this.points.attributes.aAlpha.needsUpdate = true;
    this.points.attributes.aAccent.needsUpdate = true;
  }
}
