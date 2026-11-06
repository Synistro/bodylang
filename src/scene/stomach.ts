import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WAVE_SPEEDUP, STOMACH } from "../model/params";
import type { OrganMeta } from "./assets";
import { createChunkMaterial, createOrganMaterial, createOutlineMaterial, Palette } from "./materials";

export interface StomachItem {
  color: THREE.Color;
  count: number;
}


// Visible Human has no stomach mesh, and a stomach has to change shape with what's in it anyway, so
// it is lofted here. Each section runs from the lesser curvature, the short inner bend that stays
// put, to the greater curvature, the long outer bend that stretches as the stomach fills. Positions
// are on the male reference body, in the organ's own tilted plane; other bodies get them through an
// affine fit on three landmarks the stomach actually touches.
const PLANE = {
  origin: new THREE.Vector3(0, 1.44, 0.103),
  across: new THREE.Vector3(1, 0, 0),
  down: new THREE.Vector3(0, -0.882, 0.47),
  lift: new THREE.Vector3(0, 0.47, 0.882),
};
const SECTIONS: { inner: [number, number]; outer: [number, number]; lift: number }[] = [
  { inner: [0.03, 0.021], outer: [0.041, 0.011], lift: -0.0165 }, // cardia, where the esophagus joins
  { inner: [0.033, 0.032], outer: [0.06, -0.02], lift: -0.012 },
  { inner: [0.037, 0.045], outer: [0.1, -0.044], lift: -0.006 }, // fundus, the dome above the entry
  { inner: [0.042, 0.06], outer: [0.148, -0.012], lift: -0.001 },
  { inner: [0.046, 0.078], outer: [0.172, 0.052], lift: 0.002 }, // body
  { inner: [0.047, 0.093], outer: [0.17, 0.125], lift: 0.003 },
  { inner: [0.043, 0.105], outer: [0.132, 0.19], lift: 0.003 },
  { inner: [0.035, 0.11], outer: [0.086, 0.212], lift: 0.002 }, // antrum, the grinding end
  { inner: [0.027, 0.108], outer: [0.053, 0.182], lift: 0 },
  { inner: [0.019, 0.103], outer: [0.031, 0.14], lift: -0.002 },
  { inner: [0.012, 0.098], outer: [0.018, 0.114], lift: -0.004 }, // pyloric canal
  { inner: [0.0075, 0.097], outer: [0.0105, 0.106], lift: -0.0058 }, // pylorus, the outlet
];
const CENTER_IN_PLANE = [0.082, 0.092, 0] as const;
const STOMACH_REFERENCE_ANCHORS = {
  esophageal_impression_of_liver: [0.0311, 1.3912, 0.1209],
  gastric_surface_of_spleen: [0.0772, 1.3859, 0.0719],
  duodenum_superior: [0.0029, 1.3462, 0.1393],
} as const;

const RINGS = 96;
const RADIAL = 28;
const FLATTEN = 0.8; // a stomach is wider than it is deep
const MIN_SCALE = 0.3;
const FUNDUS_FLOOR = 0.62; // the dome holds its bubble of gas even when the stomach is empty
const CONTENTS_INSET = 0.9;
const SMOOTH_RATE = 3;

const WAVE = { from: 0.28, to: 1.03, width: 0.055, amplitudeBody: 0.06, amplitudeAntrum: 0.42, stillPhase: 0.62 };
const GATE = { opensAt: 0.78, wideAt: 0.86, narrowsAt: 0.95, closedAt: 1, closedShare: 0.42 };
const RELEASE_AT = 0.84; // the point in each wave when the outlet lets pieces go

const MAX_PIECES = 90;
const SLOT_COUNT = 150;
const SLOT_ATTEMPTS = 14000;
const SLOT_REFERENCE_SCALE = 0.55;
const SLOT_SPACING = 0.0172;
const PIECE_RADIUS_AT_FULL = 0.0098; // pieces shrink with the stomach, so they never crowd each other
const PIECE_OUTLINE = 1.1;
const PIECE_OUTLINE_OPACITY = 0.3; // a thin soft edge
const PIECE_DETAIL = 1;
const PIECE_FIT_TRIES = 4;
const HOOK_FROM_U = 0.55;
const PIECE_FIT_STEP = 0.6;
const PIECE_SHOW_RATE = 6;
const PIECE_COLOR_RATE = 3;

const LEAVING_POOL = 14;
const KCAL_PER_LEAVING_PIECE = 0.75;
const LEAVING_RADIUS = 0.0034;
const LEAVING_SECONDS = 3.4;
const LEAVING_STAGGER_SECONDS = 0.16;
const LEAVING_FROM_U = 0.84;

const FIBRES = 14;
const FIBRE_OPACITY = 0.2;
const BAND_OPACITY = 0.55;
const PYLORUS_BAND_U = [0.955, 0.98];
// Line work and the pieces leaving belong to the close-up: the whole-body view stays calm.
const CLOSE_UP = { fullAt: 1.15, goneAt: 2.3 };

const COS = Array.from({ length: RADIAL }, (_, i) => Math.cos((i / RADIAL) * Math.PI * 2));
const SIN = Array.from({ length: RADIAL }, (_, i) => Math.sin((i / RADIAL) * Math.PI * 2));
const { smoothstep } = THREE.MathUtils;
const bump = (x: number, center: number, width: number) => Math.exp(-(((x - center) / width) ** 2));

// How far the wave has narrowed the stomach at u: 1 is untouched.
function waveSqueeze(u: number, crest: number, strength: number) {
  const amplitude = WAVE.amplitudeBody + (WAVE.amplitudeAntrum - WAVE.amplitudeBody) * smoothstep(u, 0.38, 0.85);
  return 1 - amplitude * strength * bump(u, crest, WAVE.width);
}

const inPlane = (a: number, b: number, lift: number) => PLANE.origin.clone().addScaledVector(PLANE.across, a).addScaledVector(PLANE.down, b).addScaledVector(PLANE.lift, lift);

function anchorTransform(meta: OrganMeta) {
  const names = Object.keys(STOMACH_REFERENCE_ANCHORS) as (keyof typeof STOMACH_REFERENCE_ANCHORS)[];
  const src = names.map((n) => new THREE.Vector3().fromArray(STOMACH_REFERENCE_ANCHORS[n]));
  const dst = names.map((n) => new THREE.Vector3().fromArray(meta.landmarks[n]));
  const basis = (p: THREE.Vector3[]) => {
    const a = p[1].clone().sub(p[0]);
    const b = p[2].clone().sub(p[0]);
    const c = a.clone().cross(b).normalize().multiplyScalar((a.length() + b.length()) / 2);
    return new THREE.Matrix4().makeBasis(a, b, c);
  };
  const m = basis(dst).multiply(basis(src).invert());
  const place = (v: THREE.Vector3) => v.clone().sub(src[0]).applyMatrix4(m).add(dst[0]);

  // The landmarks decide where the two fixed ends go. Between them a full affine fit would shear the
  // organ out of shape on a body whose landmarks sit differently, so the shape only turns, stretches
  // along the line from end to end, and takes its girth from how far apart the liver and spleen sit.
  const ends = [SECTIONS[0], SECTIONS[SECTIONS.length - 1]].map((s) => inPlane((s.inner[0] + s.outer[0]) / 2, (s.inner[1] + s.outer[1]) / 2, s.lift));
  const [from, to] = [place(ends[0]), place(ends[1])];
  const axis = ends[1].clone().sub(ends[0]);
  const stretch = to.distanceTo(from) / axis.length();
  axis.normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(axis, to.clone().sub(from).normalize());
  const girth = dst[1].distanceTo(dst[0]) / src[1].distanceTo(src[0]);
  return (v: THREE.Vector3) => {
    const offset = v.clone().sub(ends[0]);
    const along = offset.dot(axis);
    const across = offset.addScaledVector(axis, -along).multiplyScalar(girth);
    return across.addScaledVector(axis, along * stretch).applyQuaternion(turn).add(from);
  };
}

// A soft, irregular lump: a sphere with a few broad swellings, with a largest radius of 1.
function chewedPiece() {
  const round = new THREE.IcosahedronGeometry(1, PIECE_DETAIL);
  round.deleteAttribute("normal");
  round.deleteAttribute("uv");
  const lump = mergeVertices(round, 1e-4);
  const positions = lump.getAttribute("position");
  const vertex = new THREE.Vector3();
  let largest = 0;
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i);
    const swell = 1 + 0.16 * Math.sin(2.3 * vertex.x + 0.7) * Math.cos(1.9 * vertex.y - 0.4) + 0.11 * Math.sin(3.1 * vertex.z + 1.9) + 0.07 * Math.cos(4.3 * vertex.y + 2.3 * vertex.x);
    vertex.multiplyScalar(swell);
    positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    largest = Math.max(largest, vertex.length());
  }
  lump.scale(1 / largest, 1 / largest, 1 / largest);
  lump.computeVertexNormals();
  return lump;
}

// The first part of the intestine, from the outlet: the path that stays inside the drawn duodenum, down
// as far as its lowest point.
export function firstPartOfIntestine(meta: OrganMeta, outlet: THREE.Vector3) {
  const inside = meta.centerlines.duodenum_inside.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const lowest = inside.reduce((best, point, i) => (point.y < inside[best].y ? i : best), 0);
  return [outlet.clone(), ...inside.slice(0, lowest + 1)];
}

// A closed tube of rings written directly by the caller, with normals taken from the surface itself
// so the contour stays true over the dome and into the narrow outlet.
class RingSurface {
  readonly geometry = new THREE.BufferGeometry();
  readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly normalAttribute: THREE.BufferAttribute;
  private oriented = false;

  constructor() {
    const count = (RINGS + 1) * RADIAL + 2;
    this.positions = new Float32Array(count * 3);
    this.normals = new Float32Array(count * 3);
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.normalAttribute = new THREE.BufferAttribute(this.normals, 3);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.normalAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.positionAttribute);
    this.geometry.setAttribute("normal", this.normalAttribute);
    const index: number[] = [];
    for (let j = 0; j < RINGS; j++) {
      for (let i = 0; i < RADIAL; i++) {
        const a = j * RADIAL + i;
        const b = j * RADIAL + (i + 1) % RADIAL;
        const c = a + RADIAL;
        const d = b + RADIAL;
        index.push(a, b, c, c, b, d);
      }
    }
    const capStart = (RINGS + 1) * RADIAL;
    const capEnd = capStart + 1;
    for (let i = 0; i < RADIAL; i++) {
      index.push(capStart, (i + 1) % RADIAL, i);
      index.push(capEnd, RINGS * RADIAL + i, RINGS * RADIAL + (i + 1) % RADIAL);
    }
    this.geometry.setIndex(index);
  }

  finish() {
    const p = this.positions;
    const n = this.normals;
    const at = (j: number, i: number) => (j * RADIAL + ((i + RADIAL) % RADIAL)) * 3;
    for (let j = 0; j <= RINGS; j++) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < RADIAL; i++) {
        const o = at(j, i);
        cx += p[o];
        cy += p[o + 1];
        cz += p[o + 2];
      }
      cx /= RADIAL;
      cy /= RADIAL;
      cz /= RADIAL;
      const before = Math.max(0, j - 1);
      const after = Math.min(RINGS, j + 1);
      for (let i = 0; i < RADIAL; i++) {
        const o = at(j, i);
        const around0 = at(j, i - 1);
        const around1 = at(j, i + 1);
        const along0 = at(before, i);
        const along1 = at(after, i);
        const ax = p[around1] - p[around0];
        const ay = p[around1 + 1] - p[around0 + 1];
        const az = p[around1 + 2] - p[around0 + 2];
        const bx = p[along1] - p[along0];
        const by = p[along1 + 1] - p[along0 + 1];
        const bz = p[along1 + 2] - p[along0 + 2];
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const outX = p[o] - cx;
        const outY = p[o + 1] - cy;
        const outZ = p[o + 2] - cz;
        if (nx * outX + ny * outY + nz * outZ < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        let length = Math.hypot(nx, ny, nz);
        if (length < 1e-10) {
          nx = outX;
          ny = outY;
          nz = outZ;
          length = Math.hypot(nx, ny, nz) || 1;
        }
        n[o] = nx / length;
        n[o + 1] = ny / length;
        n[o + 2] = nz / length;
      }
      if (j === 0 || j === RINGS) {
        const cap = ((RINGS + 1) * RADIAL + (j === 0 ? 0 : 1)) * 3;
        p[cap] = cx;
        p[cap + 1] = cy;
        p[cap + 2] = cz;
        const bx = p[at(after, 0)] - p[at(before, 0)];
        const by = p[at(after, 0) + 1] - p[at(before, 0) + 1];
        const bz = p[at(after, 0) + 2] - p[at(before, 0) + 2];
        const sign = j === 0 ? -1 : 1;
        const length = Math.hypot(bx, by, bz) || 1;
        n[cap] = (sign * bx) / length;
        n[cap + 1] = (sign * by) / length;
        n[cap + 2] = (sign * bz) / length;
      }
    }
    if (!this.oriented) this.orient();
    this.positionAttribute.needsUpdate = true;
    this.normalAttribute.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  // The material flips normals on back faces, so triangles must wind outward like the normals do.
  private orient() {
    this.oriented = true;
    const index = this.geometry.index;
    if (!index) return;
    const probe = Math.floor(RINGS / 2) * RADIAL * 6;
    const [a, b, c] = [index.getX(probe), index.getX(probe + 1), index.getX(probe + 2)];
    const v = (i: number) => new THREE.Vector3().fromArray(this.positions, i * 3);
    const facing = v(b).sub(v(a)).cross(v(c).sub(v(a))).dot(new THREE.Vector3().fromArray(this.normals, a * 3));
    if (facing >= 0) return;
    const flipped = Array.from(index.array);
    for (let i = 0; i < flipped.length; i += 3) [flipped[i + 1], flipped[i + 2]] = [flipped[i + 2], flipped[i + 1]];
    this.geometry.setIndex(flipped);
  }
}

// Lines drawn over the wall whose vertices change every frame.
class DynamicLines {
  readonly object: THREE.LineSegments;
  readonly material: THREE.LineBasicMaterial;
  private readonly buffer: Float32Array;
  private readonly attribute: THREE.BufferAttribute;
  private written = 0;

  constructor(vertices: number, ink: string) {
    this.buffer = new Float32Array(vertices * 3);
    this.attribute = new THREE.BufferAttribute(this.buffer, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", this.attribute);
    this.material = new THREE.LineBasicMaterial({ color: ink, transparent: true, depthWrite: false });
    this.object = new THREE.LineSegments(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 7;
  }

  begin() {
    this.written = 0;
  }

  segment(from: ArrayLike<number>, fromAt: number, to: ArrayLike<number>, toAt: number) {
    const b = this.buffer;
    let w = this.written * 3;
    if (w + 6 > b.length) return;
    b[w++] = from[fromAt];
    b[w++] = from[fromAt + 1];
    b[w++] = from[fromAt + 2];
    b[w++] = to[toAt];
    b[w++] = to[toAt + 1];
    b[w] = to[toAt + 2];
    this.written += 2;
  }

  end() {
    this.object.geometry.setDrawRange(0, this.written);
    this.attribute.needsUpdate = true;
  }
}

interface PieceSlot {
  u: number;
  v: number;
  w: number;
  size: number;
  spin: THREE.Quaternion;
  shown: number;
  color: THREE.Color;
}

export class Stomach {
  readonly group = new THREE.Group();
  readonly stomachPath: THREE.CatmullRomCurve3;
  readonly esophagusPath: THREE.CatmullRomCurve3;
  readonly wall: THREE.Mesh;
  readonly wallMaterial: THREE.ShaderMaterial;
  readonly contents: THREE.Mesh;
  readonly contentsMaterial: THREE.ShaderMaterial;
  readonly esophagusMaterial: THREE.ShaderMaterial;
  readonly center: THREE.Vector3;
  private readonly wallSurface = new RingSurface();
  private readonly contentsSurface = new RingSurface();
  private readonly contentsOutlineMaterial: THREE.ShaderMaterial;
  private readonly fibres: DynamicLines;
  private readonly bands: DynamicLines;
  private readonly pieces: THREE.InstancedMesh;
  private readonly pieceOutlines: THREE.InstancedMesh;
  private readonly pieceMaterial: THREE.ShaderMaterial;
  private readonly pieceOutlineMaterial: THREE.MeshBasicMaterial;
  private readonly slots: PieceSlot[] = [];
  private readonly leavingRoute: { points: THREE.Vector3[]; lengths: number[]; insideStomach: number; total: number };
  private readonly ringLength: number;
  private readonly leavingBorn = new Float32Array(LEAVING_POOL).fill(-Infinity);
  private readonly motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Per ring: fixed sections, then the shape they take this frame.
  private readonly ringInner = new Float32Array((RINGS + 1) * 3);
  private readonly ringSpan = new Float32Array((RINGS + 1) * 3);
  private readonly ringCenter = new Float32Array((RINGS + 1) * 3);
  private readonly ringHalf = new Float32Array((RINGS + 1) * 3);
  private readonly ringDepth = new Float32Array((RINGS + 1) * 3);
  private readonly rimA = new Float32Array((RINGS + 1) * 3);
  private readonly rimB = new Float32Array((RINGS + 1) * 3);
  private readonly rimWet = new Uint8Array(RINGS + 1);
  private readonly depthAxis = new THREE.Vector3();
  private readonly fullVolumeMl: number;

  private readonly matrix = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();
  private readonly scaleVector = new THREE.Vector3();
  private readonly tint = new THREE.Color("#b97a24");
  private readonly centerWorld = new THREE.Vector3();
  private volume = STOMACH.restingVolumeMl;
  private scale = MIN_SCALE;
  private levelY = 0;
  private phase = 0;
  private clock = 0;
  private lastRelease = -1;
  private carriedKcal = 0;
  private nextLeaving = 0;
  private closeUp = 0;

  constructor(meta: OrganMeta, palette: Palette, resolution: THREE.Vector2) {
    const fit = anchorTransform(meta);
    const inner = SECTIONS.map((s) => fit(inPlane(s.inner[0], s.inner[1], s.lift)));
    const outer = SECTIONS.map((s) => fit(inPlane(s.outer[0], s.outer[1], s.lift)));
    const innerCurve = new THREE.CatmullRomCurve3(inner, false, "centripetal");
    const outerCurve = new THREE.CatmullRomCurve3(outer, false, "centripetal");
    for (let j = 0; j <= RINGS; j++) {
      const a = innerCurve.getPoint(j / RINGS);
      const b = outerCurve.getPoint(j / RINGS).sub(a);
      a.toArray(this.ringInner, j * 3);
      b.toArray(this.ringSpan, j * 3);
    }
    this.depthAxis.copy(fit(PLANE.origin.clone().add(PLANE.lift))).sub(fit(PLANE.origin)).normalize();
    this.fullVolumeMl = this.volumeAtFullStretch();

    // The route food takes through the middle of a part-filled stomach.
    const last = SECTIONS.length - 1;
    const middle = inner.map((p, k) => p.clone().lerp(outer[k], k === 0 || k === last ? 0.5 : 0.28));
    this.stomachPath = new THREE.CatmullRomCurve3(middle, false, "centripetal");
    this.center = fit(inPlane(CENTER_IN_PLANE[0], CENTER_IN_PLANE[1], CENTER_IN_PLANE[2]));

    this.wallMaterial = createOrganMaterial(palette);
    this.wallMaterial.uniforms.uGhost.value = 1;
    this.wallMaterial.depthWrite = false;
    this.wall = new THREE.Mesh(this.wallSurface.geometry, this.wallMaterial);
    this.wall.renderOrder = 6;
    this.wall.onBeforeRender = (_renderer, _scene, camera) => {
      this.centerWorld.copy(this.center);
      this.group.localToWorld(this.centerWorld);
      this.closeUp = 1 - smoothstep(camera.position.distanceTo(this.centerWorld), CLOSE_UP.fullAt, CLOSE_UP.goneAt);
    };

    this.contentsMaterial = createOrganMaterial(palette);
    this.contentsMaterial.depthWrite = false;
    this.contents = new THREE.Mesh(this.contentsSurface.geometry, this.contentsMaterial);
    this.contents.renderOrder = 4;
    this.contentsOutlineMaterial = createOutlineMaterial(palette, resolution);
    this.contentsOutlineMaterial.depthWrite = false; // the stomach is only drawn in outline, and what lies behind it has to show
    const contentsOutline = new THREE.Mesh(this.contentsSurface.geometry, this.contentsOutlineMaterial);
    contentsOutline.renderOrder = 1;

    this.pieceMaterial = createChunkMaterial();
    const pieceGeometry = chewedPiece();
    const capacity = MAX_PIECES + LEAVING_POOL;
    this.pieces = new THREE.InstancedMesh(pieceGeometry, this.pieceMaterial, capacity);
    this.pieces.frustumCulled = false;
    this.pieces.renderOrder = 2;
    this.pieces.count = 0;
    this.pieces.setColorAt(0, new THREE.Color("#ffffff"));
    this.pieceOutlineMaterial = new THREE.MeshBasicMaterial({ color: palette.contour, side: THREE.BackSide, transparent: true, opacity: PIECE_OUTLINE_OPACITY, depthWrite: false });
    this.pieceOutlines = new THREE.InstancedMesh(pieceGeometry, this.pieceOutlineMaterial, capacity);
    this.pieceOutlines.frustumCulled = false;
    this.pieceOutlines.renderOrder = 2;
    this.pieceOutlines.count = 0;

    this.fibres = new DynamicLines(FIBRES * RINGS * 2, palette.ink);
    this.bands = new DynamicLines((3 + PYLORUS_BAND_U.length) * RADIAL * 2 + RINGS * 4, palette.ink);

    this.shape(SLOT_REFERENCE_SCALE, 0, 0, 1);
    this.ringLength = this.lengthAlong(0, RINGS) / RINGS;
    this.placeSlots();
    this.leavingRoute = this.buildLeavingRoute(meta);

    // The esophagus runs behind the trachea and in front of the spine, down to where the stomach starts.
    const trachea = new THREE.Vector3().fromArray(meta.landmarks.trachea);
    const cord = new THREE.Vector3().fromArray(meta.organs.spinal_cord.center);
    const top = meta.organs.airway.max[1];
    const cardia = middle[0];
    const behindTrachea = (trachea.z + cord.z) / 2 + 0.01;
    this.esophagusPath = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, top + 0.03, behindTrachea + 0.012),
        new THREE.Vector3(0, top - 0.06, behindTrachea),
        new THREE.Vector3(0.002, (top + cardia.y) / 2 + 0.03, behindTrachea - 0.004),
        new THREE.Vector3(cardia.x * 0.28, (top + cardia.y) / 2 - 0.04, (behindTrachea + cardia.z) / 2 - 0.006),
        new THREE.Vector3(cardia.x * 0.7, cardia.y + 0.03, cardia.z - 0.004),
        cardia.clone(),
      ],
      false,
      "centripetal",
    );
    this.esophagusMaterial = createOrganMaterial(palette);
    this.esophagusMaterial.uniforms.uGhost.value = 1;
    this.esophagusMaterial.depthWrite = false;
    const esophagus = new THREE.Mesh(new THREE.TubeGeometry(this.esophagusPath, 60, 0.0078, 10, false), this.esophagusMaterial);
    esophagus.renderOrder = 6;

    this.group.add(contentsOutline, this.pieceOutlines, this.pieces, this.contents, esophagus, this.wall, this.fibres.object, this.bands.object);
    this.scale = this.scaleFor(this.volume);
    this.shape(this.scale, 0, 0, 0);
    this.writeWall();
    this.writeContents(this.levelFor(this.volume));
  }

  private volumeAtFullStretch() {
    let litres = 0;
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let j = 0; j <= RINGS; j++) {
      const o = j * 3;
      const hx = this.ringSpan[o] / 2;
      const hy = this.ringSpan[o + 1] / 2;
      const hz = this.ringSpan[o + 2] / 2;
      const cx = this.ringInner[o] + hx;
      const cy = this.ringInner[o + 1] + hy;
      const cz = this.ringInner[o + 2] + hz;
      if (j > 0) {
        const half = Math.hypot(hx, hy, hz);
        litres += Math.PI * half * half * FLATTEN * Math.hypot(cx - px, cy - py, cz - pz) * 1000;
      }
      px = cx;
      py = cy;
      pz = cz;
    }
    return litres * 1000;
  }

  // What the model's millilitres look like: the cross-section grows with volume along a fixed length.
  private scaleFor(volumeMl: number) {
    return Math.min(1, Math.max(MIN_SCALE, Math.sqrt(volumeMl / this.fullVolumeMl)));
  }

  private levelFor(volumeMl: number) {
    const fill = Math.max(0, Math.min(1, (volumeMl - STOMACH.restingVolumeMl) / (STOMACH.fullnessMl - STOMACH.restingVolumeMl)));
    let bottom = Infinity;
    for (let j = 0; j <= RINGS; j++) {
      const o = j * 3;
      bottom = Math.min(bottom, this.ringCenter[o + 1] - Math.hypot(this.ringHalf[o + 1], this.ringDepth[o + 1]));
    }
    return THREE.MathUtils.lerp(bottom, this.ringCenter[1], 0.1 + 0.8 * Math.sqrt(fill));
  }

  // Writes where every ring sits this frame. wave is the crest's strength, 0 when nothing is squeezing.
  private shape(scale: number, crest: number, wave: number, gate: number) {
    for (let j = 0; j <= RINGS; j++) {
      const u = j / RINGS;
      const o = j * 3;
      let stretch = THREE.MathUtils.lerp(Math.max(scale, FUNDUS_FLOOR), scale, smoothstep(u, 0.2, 0.38));
      stretch = THREE.MathUtils.lerp(1, stretch, smoothstep(u, 0, 0.1)); // the cardia keeps its size
      stretch = THREE.MathUtils.lerp(stretch, 1, smoothstep(u, 0.76, 0.93)); // the canal is muscle and keeps its size
      let squeeze = waveSqueeze(u, crest, wave);
      squeeze *= THREE.MathUtils.lerp(1, THREE.MathUtils.lerp(GATE.closedShare, 1, gate), smoothstep(u, 0.9, 0.97));
      const hx = this.ringSpan[o] * stretch * 0.5;
      const hy = this.ringSpan[o + 1] * stretch * 0.5;
      const hz = this.ringSpan[o + 2] * stretch * 0.5;
      this.ringCenter[o] = this.ringInner[o] + hx;
      this.ringCenter[o + 1] = this.ringInner[o + 1] + hy;
      this.ringCenter[o + 2] = this.ringInner[o + 2] + hz;
      this.ringHalf[o] = hx * squeeze;
      this.ringHalf[o + 1] = hy * squeeze;
      this.ringHalf[o + 2] = hz * squeeze;
      const depth = Math.hypot(hx, hy, hz) * FLATTEN * squeeze;
      this.ringDepth[o] = this.depthAxis.x * depth;
      this.ringDepth[o + 1] = this.depthAxis.y * depth;
      this.ringDepth[o + 2] = this.depthAxis.z * depth;
    }
  }

  private pointInRing(u: number, v: number, w: number, out: THREE.Vector3) {
    const position = Math.max(0, Math.min(RINGS - 1e-4, u * RINGS));
    const j = Math.floor(position);
    const f = position - j;
    const a = j * 3;
    const b = a + 3;
    const mix = (from: Float32Array, axis: number) => from[a + axis] + (from[b + axis] - from[a + axis]) * f;
    return out.set(
      mix(this.ringCenter, 0) + mix(this.ringHalf, 0) * v + mix(this.ringDepth, 0) * w,
      mix(this.ringCenter, 1) + mix(this.ringHalf, 1) * v + mix(this.ringDepth, 1) * w,
      mix(this.ringCenter, 2) + mix(this.ringHalf, 2) * v + mix(this.ringDepth, 2) * w,
    );
  }

  // Slots stay where they are from frame to frame and keep their distance, and the lowest fill first.
  private placeSlots() {
    const random = () => THREE.MathUtils.seededRandom();
    THREE.MathUtils.seededRandom(41);
    const taken: { slot: PieceSlot; at: THREE.Vector3 }[] = [];
    for (let attempt = 0; attempt < SLOT_ATTEMPTS && taken.length < SLOT_COUNT; attempt++) {
      const u = THREE.MathUtils.lerp(0.12, 0.93, random());
      const reach = Math.sqrt(random()) * 0.8;
      const angle = random() * Math.PI * 2;
      const at = this.pointInRing(u, Math.cos(angle) * reach, Math.sin(angle) * reach, new THREE.Vector3());
      if (taken.some((t) => t.at.distanceToSquared(at) < SLOT_SPACING * SLOT_SPACING)) continue;
      taken.push({
        at,
        slot: {
          u,
          v: Math.cos(angle) * reach,
          w: Math.sin(angle) * reach,
          size: THREE.MathUtils.lerp(0.82, 1.1, random()),
          spin: new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6.28, random() * 6.28, random() * 6.28)),
          shown: 0,
          color: new THREE.Color("#ffffff"),
        },
      });
    }
    taken.sort((a, b) => a.at.y - b.at.y);
    for (const t of taken) this.slots.push(t.slot);
  }

  private lengthAlong(fromRing: number, toRing: number) {
    let total = 0;
    for (let j = fromRing + 1; j <= toRing; j++) {
      const a = (j - 1) * 3;
      const b = j * 3;
      total += Math.hypot(this.ringCenter[b] - this.ringCenter[a], this.ringCenter[b + 1] - this.ringCenter[a + 1], this.ringCenter[b + 2] - this.ringCenter[a + 2]);
    }
    return total;
  }

  private buildLeavingRoute(meta: OrganMeta) {
    const outlet = new THREE.Vector3().fromArray(this.ringCenter, RINGS * 3);
    const points = firstPartOfIntestine(meta, outlet);
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    const insideStomach = this.lengthAlong(Math.round(LEAVING_FROM_U * RINGS), RINGS);
    return { points, lengths, insideStomach, total: insideStomach + lengths[lengths.length - 1] };
  }

  // How far a point is from the wall near u, as the wall stands this frame.
  private clearance(u: number, at: THREE.Vector3, reach: number) {
    const wall = this.wallSurface.positions;
    const here = Math.max(0, Math.min(RINGS, Math.round(u * RINGS)));
    const rings = Math.ceil(reach / this.ringLength) + 1;
    // Past the bend the stomach doubles back on itself, so the canal's wall is near pieces rings away.
    const from = u > HOOK_FROM_U ? Math.round(HOOK_FROM_U * RINGS) : Math.max(0, here - rings);
    const to = u > HOOK_FROM_U || here + rings > HOOK_FROM_U * RINGS ? RINGS : here + rings;
    let nearest = Infinity;
    for (let j = from; j <= to; j++) {
      for (let i = j * RADIAL * 3, end = i + RADIAL * 3; i < end; i += 3) {
        const dx = wall[i] - at.x;
        const dy = wall[i + 1] - at.y;
        const dz = wall[i + 2] - at.z;
        nearest = Math.min(nearest, dx * dx + dy * dy + dz * dz);
      }
    }
    return Math.sqrt(nearest);
  }

  // Puts a piece where it fits this frame, moving it toward the middle of its ring and then shrinking it
  // if it must: the canal is far narrower than the pieces of a full stomach, rings fan out round the
  // bend into it, and the wave narrows everything it passes. Answers the radius it can have.
  private placeInside(u: number, v: number, w: number, wanted: number, out: THREE.Vector3) {
    const needs = wanted * PIECE_OUTLINE;
    let toward = 1;
    let room = 0;
    for (let tries = 0; tries < PIECE_FIT_TRIES; tries++) {
      this.pointInRing(u, v * toward, w * toward, out);
      room = this.clearance(u, out, needs);
      if (room >= needs) return wanted;
      toward *= tries === PIECE_FIT_TRIES - 2 ? 0 : PIECE_FIT_STEP;
    }
    return room / PIECE_OUTLINE;
  }

  setPalette(palette: Palette) {
    for (const m of [this.wallMaterial, this.contentsMaterial, this.esophagusMaterial]) {
      const u = m.uniforms;
      u.uTone1.value.set(palette.tone1);
      u.uTone2.value.set(palette.tone2);
      u.uTone3.value.set(palette.tone3);
      u.uInk.value.set(palette.ink);
      u.uCavity.value.set(palette.cavity);
    }
    this.contentsOutlineMaterial.uniforms.uInk.value.set(palette.ink);
    this.pieceOutlineMaterial.color.set(palette.contour);
    this.fibres.material.color.set(palette.ink);
    this.bands.material.color.set(palette.ink);
  }

  // Volume drives shape directly: cut the stomach open at 17:00 and what you see is the model's millilitres.
  update(dt: number, volumeMl: number, tint: THREE.Color, slowWavesPerMin: number, items: StomachItem[], emptyingKcalPerMin: number) {
    const still = this.motion.matches;
    this.volume += (volumeMl - this.volume) * (1 - Math.exp(-dt * SMOOTH_RATE));
    this.tint.lerp(tint, 1 - Math.exp(-dt * SMOOTH_RATE));
    this.scale = this.scaleFor(this.volume);
    this.clock += dt;
    if (!still) this.phase += dt * (slowWavesPerMin / 60) * WAVE_SPEEDUP;
    const wavePhase = still ? WAVE.stillPhase : this.phase % 1;
    const crest = THREE.MathUtils.lerp(WAVE.from, WAVE.to, wavePhase);

    const food = smoothstep(this.volume, 60, 200);
    const strength = THREE.MathUtils.lerp(0.35, 1, food);
    const open = smoothstep(wavePhase, GATE.opensAt, GATE.wideAt) * (1 - smoothstep(wavePhase, GATE.narrowsAt, GATE.closedAt));
    const drive = Math.max(smoothstep(emptyingKcalPerMin, 0, 3), 0.5 * food);

    this.shape(this.scale, crest, strength, open * drive);
    this.levelY = this.levelFor(this.volume);
    this.writeWall();
    this.writeContents(this.levelY);
    this.releasePieces(emptyingKcalPerMin, slowWavesPerMin, still);
    this.placePieces(items, dt, crest, strength);
    this.writeLines(crest, strength);

    this.contentsMaterial.uniforms.uTint.value.copy(this.tint);
    this.contentsMaterial.uniforms.uTintAmount.value = 0.72;
    this.contentsMaterial.uniforms.uGhost.value = 1;
    this.contentsMaterial.uniforms.uFill.value = 0.5;
    this.contents.visible = smoothstep(this.volume, 60, 130) > 0.02;
    this.contentsOutlineMaterial.uniforms.uOpacity.value = 0.32 * this.contentsMaterial.uniforms.uOpacity.value * (this.contents.visible ? 1 : 0);
  }

  private writeWall() {
    const p = this.wallSurface.positions;
    let w = 0;
    for (let j = 0; j <= RINGS; j++) {
      const o = j * 3;
      for (let i = 0; i < RADIAL; i++) {
        p[w++] = this.ringCenter[o] + this.ringHalf[o] * COS[i] + this.ringDepth[o] * SIN[i];
        p[w++] = this.ringCenter[o + 1] + this.ringHalf[o + 1] * COS[i] + this.ringDepth[o + 1] * SIN[i];
        p[w++] = this.ringCenter[o + 2] + this.ringHalf[o + 2] * COS[i] + this.ringDepth[o + 2] * SIN[i];
      }
    }
    this.wallSurface.finish();
  }

  // The pool inside: the wall's shape cut flat at the level, because liquid settles under gravity.
  private writeContents(level: number) {
    const p = this.contentsSurface.positions;
    let w = 0;
    for (let j = 0; j <= RINGS; j++) {
      const o = j * 3;
      for (let i = 0; i < RADIAL; i++) {
        p[w++] = this.ringCenter[o] + this.ringHalf[o] * COS[i] * CONTENTS_INSET + this.ringDepth[o] * SIN[i] * CONTENTS_INSET;
        p[w++] = this.ringCenter[o + 1] + this.ringHalf[o + 1] * COS[i] * CONTENTS_INSET + this.ringDepth[o + 1] * SIN[i] * CONTENTS_INSET;
        p[w++] = this.ringCenter[o + 2] + this.ringHalf[o + 2] * COS[i] * CONTENTS_INSET + this.ringDepth[o + 2] * SIN[i] * CONTENTS_INSET;
      }
    }
    let firstWet = -1;
    let lastWet = -1;
    for (let j = 0; j <= RINGS; j++) {
      this.rimWet[j] = 0;
      let below = false;
      let above = false;
      for (let i = 0; i < RADIAL; i++) {
        if (p[(j * RADIAL + i) * 3 + 1] <= level) below = true;
        else above = true;
      }
      if (!below) continue;
      if (firstWet < 0) firstWet = j;
      lastWet = j;
      if (above) this.cutRing(j, level);
    }
    if (firstWet >= 0) {
      for (let j = 0; j < firstWet; j++) this.copyRing(p, firstWet, j);
      for (let j = lastWet + 1; j <= RINGS; j++) this.copyRing(p, lastWet, j);
      for (let j = firstWet + 1; j < lastWet; j++) {
        let wet = false;
        for (let i = 0; i < RADIAL && !wet; i++) wet = p[(j * RADIAL + i) * 3 + 1] <= level;
        if (!wet) this.copyRing(p, j - 1, j);
      }
    }
    this.contentsSurface.finish();
  }

  // Everything above the level slides onto the straight chord where this ring meets the surface.
  private cutRing(j: number, level: number) {
    const p = this.contentsSurface.positions;
    const y = (i: number) => p[(j * RADIAL + ((i + RADIAL) % RADIAL)) * 3 + 1];
    let rise = -1;
    for (let i = 0; i < RADIAL; i++) {
      if (y(i) <= level && y(i + 1) > level) {
        rise = i;
        break;
      }
    }
    if (rise < 0) return;
    const firstAbove = rise + 1;
    let aboveCount = 1;
    while (aboveCount < RADIAL && y(firstAbove + aboveCount) > level) aboveCount++;
    const crossing = (from: number, to: number, out: Float32Array) => {
      const a = (j * RADIAL + ((from + RADIAL) % RADIAL)) * 3;
      const b = (j * RADIAL + ((to + RADIAL) % RADIAL)) * 3;
      const k = (level - p[a + 1]) / (p[b + 1] - p[a + 1]);
      const o = j * 3;
      out[o] = p[a] + (p[b] - p[a]) * k;
      out[o + 1] = level;
      out[o + 2] = p[a + 2] + (p[b + 2] - p[a + 2]) * k;
    };
    crossing(rise, firstAbove, this.rimA);
    crossing(firstAbove + aboveCount, firstAbove + aboveCount - 1, this.rimB);
    this.rimWet[j] = 1;
    const o = j * 3;
    for (let m = 0; m < aboveCount; m++) {
      const k = aboveCount === 1 ? 0.5 : m / (aboveCount - 1);
      const at = (j * RADIAL + ((firstAbove + m) % RADIAL)) * 3;
      p[at] = this.rimA[o] + (this.rimB[o] - this.rimA[o]) * k;
      p[at + 1] = level;
      p[at + 2] = this.rimA[o + 2] + (this.rimB[o + 2] - this.rimA[o + 2]) * k;
    }
  }

  private copyRing(p: Float32Array, from: number, to: number) {
    p.copyWithin(to * RADIAL * 3, from * RADIAL * 3, (from + 1) * RADIAL * 3);
  }

  // Each wave lets out its share of the model's rate, in pieces of a fixed size.
  private releasePieces(rate: number, slowWavesPerMin: number, still: boolean) {
    if (still) return;
    const cycle = Math.floor(this.phase - RELEASE_AT);
    if (cycle <= this.lastRelease) return;
    this.lastRelease = cycle;
    this.carriedKcal += rate / slowWavesPerMin;
    const count = Math.floor(this.carriedKcal / KCAL_PER_LEAVING_PIECE);
    this.carriedKcal -= count * KCAL_PER_LEAVING_PIECE;
    for (let i = 0; i < Math.min(count, LEAVING_POOL); i++) {
      this.leavingBorn[this.nextLeaving] = this.clock + i * LEAVING_STAGGER_SECONDS;
      this.nextLeaving = (this.nextLeaving + 1) % LEAVING_POOL;
    }
  }

  private setPiece(n: number, position: THREE.Vector3, spin: THREE.Quaternion, radius: number, color: THREE.Color) {
    this.matrix.compose(position, spin, this.scaleVector.set(radius, radius * 0.82, radius * 0.72));
    this.pieces.setMatrixAt(n, this.matrix);
    this.pieces.setColorAt(n, color);
    this.matrix.compose(position, spin, this.scaleVector.set(radius * PIECE_OUTLINE, radius * 0.82 * PIECE_OUTLINE, radius * 0.72 * PIECE_OUTLINE));
    this.pieceOutlines.setMatrixAt(n, this.matrix);
  }

  // The first thing eaten takes the lowest slots, so a meal stays in tidy layers as it goes down.
  private placePieces(items: StomachItem[], dt: number, crest: number, strength: number) {
    const showStep = 1 - Math.exp(-dt * PIECE_SHOW_RATE);
    const colorStep = 1 - Math.exp(-dt * PIECE_COLOR_RATE);
    const radiusNow = PIECE_RADIUS_AT_FULL * this.scale;
    let itemIndex = 0;
    let usedOfItem = 0;
    let n = 0;
    let placed = 0;
    for (const slot of this.slots) {
      const pushed = slot.u + 0.012 * strength * bump(slot.u, crest, WAVE.width * 1.3);
      const at = this.point;
      const radius = this.placeInside(pushed, slot.v, slot.w, radiusNow * slot.size, at);
      while (itemIndex < items.length && usedOfItem >= items[itemIndex].count) {
        itemIndex++;
        usedOfItem = 0;
      }
      const wanted = placed < MAX_PIECES && itemIndex < items.length && at.y + radiusNow < this.levelY;
      if (wanted) {
        const color = items[itemIndex].color;
        if (slot.shown < 0.01) slot.color.copy(color);
        else slot.color.lerp(color, colorStep);
        usedOfItem++;
        placed++;
      }
      slot.shown += ((wanted ? 1 : 0) - slot.shown) * showStep;
      if (slot.shown < 0.01 || n >= MAX_PIECES) continue;
      this.setPiece(n++, at, slot.spin, radius * slot.shown, slot.color);
    }
    const route = this.leavingRoute;
    for (let k = 0; k < LEAVING_POOL; k++) {
      const age = this.clock - this.leavingBorn[k];
      if (age < 0 || age > LEAVING_SECONDS || this.closeUp < 0.01) continue;
      const tau = age / LEAVING_SECONDS;
      const distance = (1 - (1 - tau) ** 1.6) * route.total;
      let radius = LEAVING_RADIUS;
      if (distance < route.insideStomach) {
        const u = THREE.MathUtils.lerp(LEAVING_FROM_U, 1, distance / route.insideStomach);
        radius = this.placeInside(u, 0, 0, LEAVING_RADIUS, this.point);
      } else {
        const onward = distance - route.insideStomach;
        let i = 1;
        while (i < route.lengths.length - 1 && route.lengths[i] < onward) i++;
        const span = route.lengths[i] - route.lengths[i - 1] || 1;
        this.point.lerpVectors(route.points[i - 1], route.points[i], (onward - route.lengths[i - 1]) / span);
      }
      const fade = 1 - smoothstep(tau, 0.8, 1);
      this.setPiece(n++, this.point, this.slots[k].spin, radius * this.closeUp * fade, this.tint);
    }
    this.pieces.count = n;
    this.pieceOutlines.count = n;
    this.pieces.instanceMatrix.needsUpdate = true;
    this.pieceOutlines.instanceMatrix.needsUpdate = true;
    if (this.pieces.instanceColor) this.pieces.instanceColor.needsUpdate = true;
  }

  // Fine line work on the wall: muscle fibres that bunch where the wave pinches, the wave's own
  // contraction band, the ring of the outlet, and the rim of the pool.
  private writeLines(crest: number, strength: number) {
    const wallOpacity: number = this.wallMaterial.uniforms.uOpacity.value;
    this.fibres.object.visible = this.closeUp > 0.01;
    this.bands.object.visible = this.closeUp > 0.01;
    if (this.closeUp <= 0.01) return;
    this.fibres.material.opacity = FIBRE_OPACITY * this.closeUp * wallOpacity;
    this.bands.material.opacity = BAND_OPACITY * this.closeUp * wallOpacity;

    const wall = this.wallSurface.positions;
    const at = (j: number, i: number) => (j * RADIAL + (i % RADIAL)) * 3;
    this.fibres.begin();
    for (let f = 0; f < FIBRES; f++) {
      const i = Math.round((f / FIBRES) * RADIAL);
      for (let j = 0; j < RINGS; j++) this.fibres.segment(wall, at(j, i), wall, at(j + 1, i));
    }
    this.fibres.end();

    this.bands.begin();
    const ring = (j: number) => {
      for (let i = 0; i < RADIAL; i++) this.bands.segment(wall, at(j, i), wall, at(j, i + 1));
    };
    if (strength > 0.4 && crest < 1) {
      const middle = Math.round(crest * RINGS);
      for (const j of [middle - 2, middle, middle + 2]) if (j >= 0 && j <= RINGS) ring(j);
    }
    for (const u of PYLORUS_BAND_U) ring(Math.round(u * RINGS));
    if (this.contents.visible) {
      for (let j = 0; j < RINGS; j++) {
        if (!this.rimWet[j] || !this.rimWet[j + 1]) continue;
        this.bands.segment(this.rimA, j * 3, this.rimA, (j + 1) * 3);
        this.bands.segment(this.rimB, j * 3, this.rimB, (j + 1) * 3);
      }
    }
    this.bands.end();
  }

  setChunkOpacity(opacity: number) {
    this.pieceMaterial.uniforms.uOpacity.value = opacity;
    this.pieceOutlineMaterial.opacity = opacity * PIECE_OUTLINE_OPACITY;
    this.pieces.visible = opacity > 0.01;
    this.pieceOutlines.visible = this.pieces.visible;
  }
}
