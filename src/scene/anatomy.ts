import * as THREE from "three";
import type { OrganId } from "../model/ids";
import type { OrganAsset, OrganMeshMeta } from "./assets";
import { createOrganMaterial, createOutlineMaterial, createVesselMaterial, Palette } from "./materials";

export interface PartStyle {
  organ: OrganId | null; // what picking this part selects, if anything
  worksWith: OrganId | null; // a part with no organ of its own warms along with this one
  ghost: number; // how it reads at rest: 0 solid, 1 contour only
  restOpacity: number;
  subjectGhost: number; // how it reads when its system is the subject of the view
  subjectLift: number; // how far shading flattens toward the lit tone as a subject, for a lumpy shape that would read as a dark mass
  soft: number; // 0 stepped tones, 1 a continuous roll-off with no hard-edged patches
  hatch: number; // fine engraved lines over the tone
  normalPasses: number; // how far its shading is smoothed past its real shape, so small bumps draw no lines or patches
  tinted: boolean; // whether its colour follows how hard it works
  staysOpen: boolean; // stays an outline with a soft fill even in close-up
  subjectFill: number; // how much the outline of an open part is filled in
  contextOpacity: number; // how far it recedes when something else is the subject
  bareOpacity: number; // what stays when the muscle figure takes over the view
  continues: OrganId | null; // it carries on from this organ, so that organ's close-up keeps it in view
}

const part = (style: Pick<PartStyle, "organ" | "ghost" | "subjectGhost" | "contextOpacity"> & Partial<PartStyle>): PartStyle => ({
  worksWith: null,
  restOpacity: 1,
  subjectLift: 0,
  soft: 0,
  hatch: 0,
  normalPasses: 0,
  tinted: true,
  staysOpen: false,
  subjectFill: 0.09,
  bareOpacity: 0,
  continues: null,
  ...style,
});

const PARTS = {
  // With no skull on the muscle figure, a faint brain is what the outline of the head holds.
  brain: part({ organ: "brain", ghost: 0, subjectGhost: 0, soft: 1, hatch: 0.28, normalPasses: 3, contextOpacity: 0.34, bareOpacity: 0.3 }),
  heart: part({ organ: "heart", ghost: 0, subjectGhost: 0, contextOpacity: 0.6 }),
  // Lungs wrap the heart and great vessels, so they are always a pale outline with a soft fill.
  lung_L: part({ organ: "lungs", ghost: 1, subjectGhost: 0.95, subjectLift: 1, tinted: false, staysOpen: true, subjectFill: 0.42, contextOpacity: 0.42 }),
  lung_R: part({ organ: "lungs", ghost: 1, subjectGhost: 0.95, subjectLift: 1, tinted: false, staysOpen: true, subjectFill: 0.42, contextOpacity: 0.42 }),
  airway: part({ organ: "lungs", ghost: 1, restOpacity: 0.7, subjectGhost: 1, subjectLift: 1, tinted: false, staysOpen: true, subjectFill: 0.3, contextOpacity: 0.3 }),
  liver: part({ organ: "liver", ghost: 0, subjectGhost: 0, contextOpacity: 0.6 }),
  spleen: part({ organ: "spleen", ghost: 0, subjectGhost: 0, contextOpacity: 0.55 }),
  pancreas: part({ organ: "pancreas", ghost: 0, subjectGhost: 0, contextOpacity: 0.55 }),
  kidney_L: part({ organ: "kidneys", ghost: 0, subjectGhost: 0, contextOpacity: 0.55 }),
  kidney_R: part({ organ: "kidneys", ghost: 0, subjectGhost: 0, contextOpacity: 0.55 }),
  bladder: part({ organ: "bladder", ghost: 0, subjectGhost: 0, contextOpacity: 0.55 }),
  // Only one reference body has each of these, so a set simply doesn't build the others.
  uterus: part({ organ: "uterus", ghost: 0, subjectGhost: 0, contextOpacity: 0.55 }),
  ovary_L: part({ organ: "ovaries", ghost: 0, subjectGhost: 0, contextOpacity: 0.55 }),
  ovary_R: part({ organ: "ovaries", ghost: 0, subjectGhost: 0, contextOpacity: 0.55 }),
  tube_L: part({ organ: "uterus", ghost: 1, subjectGhost: 0.2, contextOpacity: 0.4 }),
  tube_R: part({ organ: "uterus", ghost: 1, subjectGhost: 0.2, contextOpacity: 0.4 }),
  prostate: part({ organ: "prostate", ghost: 0, subjectGhost: 0, contextOpacity: 0.55 }),
  spinal_cord: part({ organ: null, ghost: 1, restOpacity: 0.5, subjectGhost: 1, contextOpacity: 0.25 }),
  thymus: part({ organ: null, worksWith: "spleen", ghost: 1, restOpacity: 0.4, subjectGhost: 0, contextOpacity: 0.25 }),
  // The gut starts as contour so it doesn't wall off the abdomen, and when it is the subject it is a
  // flat pale tone with fine lines, a little open so the pancreas behind it still reads.
  small_intestine: part({ organ: "small_intestine", ghost: 1, restOpacity: 0.36, subjectGhost: 0.08, subjectLift: 0.72, soft: 1, hatch: 0.4, contextOpacity: 0.2 }),
  duodenum: part({ organ: "small_intestine", continues: "stomach", ghost: 1, subjectGhost: 0.08, subjectLift: 0.72, soft: 1, hatch: 0.4, contextOpacity: 0.36 }),
  large_intestine: part({ organ: "large_intestine", ghost: 1, subjectGhost: 0.14, subjectLift: 0.72, soft: 1, hatch: 0.4, normalPasses: 4, contextOpacity: 0.32 }),
};

export type PartName = keyof typeof PARTS;

// Where a stop or a label attaches to a shape whose middle is empty space: the mesh point nearest a
// landmark. A click there always lands on the part.
const ANCHOR_NEAR: Partial<Record<PartName, string>> = {
  pancreas: "body_of_pancreas",
  spleen: "hilum_of_spleen",
  large_intestine: "transverse_colon",
  small_intestine: "jejunum_end",
};

const PART_NAMES: PartName[] = ["brain", "heart", "lung_L", "lung_R", "airway", "liver", "spleen", "pancreas", "kidney_L", "kidney_R", "bladder", "uterus", "ovary_L", "ovary_R", "tube_L", "tube_R", "prostate", "spinal_cord", "thymus", "small_intestine", "duodenum", "large_intestine"];

export interface PartLook {
  ghost: number;
  tint: THREE.Color;
  tintAmount: number;
  opacity: number;
  highlight: number;
  fill: number;
  lift: number;
  hatch: number;
}

export interface OrganPart {
  name: PartName;
  mesh: THREE.Mesh;
  outline: THREE.Mesh;
  material: THREE.ShaderMaterial;
  outlineMaterial: THREE.ShaderMaterial;
  center: THREE.Vector3;
  anchor: THREE.Vector3;
  style: PartStyle;
  target: PartLook;
  scalePulse: number;
}

export interface VesselLook {
  color: THREE.Color;
  opacity: number;
  body: number; // 0 two faint lines, 1 a filled tube
  wave: number;
}

const EASE_RATE = 7; // per second; a change is settled within about 600 ms

function nearestVertex(geometry: THREE.BufferGeometry, to: THREE.Vector3) {
  const positions = geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  const nearest = vertex.clone();
  let best = Infinity;
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i);
    const d = vertex.distanceToSquared(to);
    if (d < best) {
      best = d;
      nearest.copy(vertex);
    }
  }
  return nearest;
}

function smoothNormals(geometry: THREE.BufferGeometry, passes: number) {
  const index = geometry.getIndex();
  const normal = geometry.getAttribute("normal");
  if (!index) throw new Error("An organ has no index");
  const from = normal.array;
  const sum = new Float32Array(from.length);
  const out = new Float32Array(from.length);
  out.set(from);
  for (let pass = 0; pass < passes; pass++) {
    sum.set(out);
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t) * 3;
      const b = index.getX(t + 1) * 3;
      const c = index.getX(t + 2) * 3;
      for (let k = 0; k < 3; k++) {
        const each = out[a + k] + out[b + k] + out[c + k];
        sum[a + k] += each;
        sum[b + k] += each;
        sum[c + k] += each;
      }
    }
    for (let v = 0; v < sum.length; v += 3) {
      const length = Math.hypot(sum[v], sum[v + 1], sum[v + 2]) || 1;
      out[v] = sum[v] / length;
      out[v + 1] = sum[v + 1] / length;
      out[v + 2] = sum[v + 2] / length;
    }
  }
  geometry.setAttribute("normal", new THREE.BufferAttribute(out, 3));
}

function buildGeometry(asset: OrganAsset, meta: OrganMeshMeta) {
  const q = new Int16Array(asset.bin, meta.pos, meta.vertexCount * 3);
  const positions = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) positions[i] = q[i] / asset.meta.quant;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(asset.bin, meta.index, meta.indexCount), 1));
  geometry.computeVertexNormals();
  if (meta.along !== undefined) geometry.setAttribute("aAlong", new THREE.BufferAttribute(new Float32Array(asset.bin, meta.along, meta.vertexCount), 1));
  return geometry;
}

export class Anatomy {
  readonly group = new THREE.Group();
  readonly parts = new Map<PartName, OrganPart>();
  readonly arteries: THREE.Mesh;
  readonly veins: THREE.Mesh;
  readonly arterial: VesselLook;
  readonly venous: VesselLook;
  private readonly arteryMaterial: THREE.ShaderMaterial;
  private readonly veinMaterial: THREE.ShaderMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly organByMesh = new Map<THREE.Object3D, OrganId | null>();
  private glycogenLevel = 0;
  private glycogenAmount = 0;

  constructor(
    readonly asset: OrganAsset,
    palette: Palette,
    resolution: THREE.Vector2,
  ) {
    for (const name of PART_NAMES) {
      const style: PartStyle = PARTS[name];
      const meta = asset.meta.organs[name];
      if (!meta) continue;
      const geometry = buildGeometry(asset, meta);
      if (style.normalPasses > 0) smoothNormals(geometry, style.normalPasses);
      const material = createOrganMaterial(palette);
      const outlineMaterial = createOutlineMaterial(palette, resolution);
      material.uniforms.uGhost.value = style.ghost;
      material.uniforms.uSoft.value = style.soft;
      material.uniforms.uHatchRound.value = meta.along === undefined ? 0 : 1;
      const mesh = new THREE.Mesh(geometry, material);
      const outline = new THREE.Mesh(geometry, outlineMaterial);
      outline.renderOrder = 0;
      mesh.renderOrder = 1;
      mesh.matrixAutoUpdate = false;
      outline.matrixAutoUpdate = false;
      this.group.add(outline, mesh);
      this.organByMesh.set(mesh, style.organ);
      const center = new THREE.Vector3().fromArray(meta.center);
      const near = ANCHOR_NEAR[name];
      const anchor = near === undefined ? center : nearestVertex(geometry, new THREE.Vector3().fromArray(asset.meta.landmarks[near]));
      this.parts.set(name, {
        name,
        mesh,
        outline,
        material,
        outlineMaterial,
        center,
        anchor,
        style,
        target: { ghost: style.ghost, tint: new THREE.Color("#ffffff"), tintAmount: 0, opacity: style.restOpacity, highlight: 0, fill: 0.12, lift: 0, hatch: 0 },
        scalePulse: 0,
      });
    }
    const liver = this.part("liver");
    const liverMeta = asset.meta.organs.liver;
    liver.material.uniforms.uLevelRange.value.set(liverMeta.min[1], liverMeta.max[1]);

    const vessel = (name: string, material: THREE.ShaderMaterial) => {
      material.uniforms.uHeart.value.copy(this.part("heart").center);
      const mesh = new THREE.Mesh(buildGeometry(asset, asset.meta.organs[name]), material);
      mesh.renderOrder = 3;
      this.group.add(mesh);
      return mesh;
    };
    this.arteryMaterial = createVesselMaterial(palette.ink, 0.2);
    this.veinMaterial = createVesselMaterial(palette.ink, 0.12);
    this.arteries = vessel("arteries", this.arteryMaterial);
    this.veins = vessel("veins", this.veinMaterial);
    this.arterial = { color: new THREE.Color(palette.ink), opacity: 0.2, body: 0, wave: 0 };
    this.venous = { color: new THREE.Color(palette.ink), opacity: 0.12, body: 0, wave: 0 };
  }

  has(name: string): name is PartName {
    return this.parts.has(name as PartName);
  }

  part(name: PartName): OrganPart {
    const part = this.parts.get(name);
    if (!part) throw new Error(`Unknown organ part ${name}`);
    return part;
  }

  organOf(mesh: THREE.Object3D): OrganId | null {
    return this.organByMesh.get(mesh) ?? null;
  }

  setPalette(palette: Palette) {
    for (const part of this.parts.values()) {
      const u = part.material.uniforms;
      u.uTone1.value.set(palette.tone1);
      u.uTone2.value.set(palette.tone2);
      u.uTone3.value.set(palette.tone3);
      u.uInk.value.set(palette.ink);
      u.uCavity.value.set(palette.cavity);
      u.uStore.value.set(palette.store);
      part.outlineMaterial.uniforms.uInk.value.set(palette.ink);
    }
  }

  // The liver as a vessel: how full it is, and how much of the view that fill should take.
  setGlycogen(level: number, amount: number) {
    this.glycogenLevel = level;
    this.glycogenAmount = amount;
  }

  // Everything eases toward its target, so a change reads as the body responding.
  update(dt: number, beat: number) {
    const k = 1 - Math.exp(-dt * EASE_RATE);
    for (const part of this.parts.values()) {
      const u = part.material.uniforms;
      u.uGhost.value += (part.target.ghost - u.uGhost.value) * k;
      u.uTintAmount.value += (part.target.tintAmount - u.uTintAmount.value) * k;
      u.uTint.value.lerp(part.target.tint, k);
      u.uOpacity.value += (part.target.opacity - u.uOpacity.value) * k;
      u.uHighlight.value += (part.target.highlight - u.uHighlight.value) * k;
      u.uFill.value += (part.target.fill - u.uFill.value) * k;
      u.uLift.value += (part.target.lift - u.uLift.value) * k;
      u.uHatch.value += (part.target.hatch - u.uHatch.value) * k;
      const solid = 1 - u.uGhost.value;
      part.outlineMaterial.uniforms.uOpacity.value = solid * solid * u.uOpacity.value;
      part.outline.visible = part.outlineMaterial.uniforms.uOpacity.value > 0.02;
      part.mesh.visible = u.uOpacity.value > 0.01;
      // Ghosted surfaces must not hide what's behind them.
      part.material.depthWrite = u.uGhost.value < 0.5;
      part.mesh.renderOrder = u.uGhost.value > 0.5 ? 5 : 1;
      const s = 1 + part.scalePulse;
      const c = part.center;
      this.matrix.makeScale(s, s, s);
      this.matrix.setPosition(c.x * (1 - s), c.y * (1 - s), c.z * (1 - s));
      part.mesh.matrix.copy(this.matrix);
      part.outline.matrix.copy(this.matrix);
      part.mesh.matrixWorldNeedsUpdate = true;
      part.outline.matrixWorldNeedsUpdate = true;
    }
    const liver = this.part("liver").material.uniforms;
    liver.uLevel.value += (this.glycogenLevel - liver.uLevel.value) * k;
    liver.uLevelAmount.value += (this.glycogenAmount - liver.uLevelAmount.value) * k;

    this.applyVessel(this.arteries, this.arteryMaterial, this.arterial, k, beat);
    this.applyVessel(this.veins, this.veinMaterial, this.venous, k, beat);
  }

  private applyVessel(mesh: THREE.Mesh, material: THREE.ShaderMaterial, look: VesselLook, k: number, beat: number) {
    const u = material.uniforms;
    u.uColor.value.lerp(look.color, k);
    u.uOpacity.value += (look.opacity - u.uOpacity.value) * k;
    u.uBody.value += (look.body - u.uBody.value) * k;
    u.uWave.value += (look.wave - u.uWave.value) * k;
    u.uBeat.value = beat;
    mesh.visible = u.uOpacity.value > 0.004;
  }
}
