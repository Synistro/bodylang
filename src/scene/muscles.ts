import * as THREE from "three";
import { MUSCLE_GROUPS, MuscleGroup } from "../model/muscleGroups";
import type { Sex } from "../model/scenario";
import type { Figure } from "./figure";
import { hullCssPixels, Palette } from "./materials";

interface MeshSectionMeta {
  vertexCount: number;
  indexCount: number;
  index: number;
  positions: Record<Sex, number>;
  skinIndex: number;
  skinWeight: number;
  shade: number;
}

interface MuscleSectionMeta extends MeshSectionMeta {
  group: number;
  fibre: number;
  fibreQuant: number;
  tendon: number;
}

export interface MuscleMeta {
  quant: number;
  groups: string[];
  joints: string[];
  referenceJoints: Record<Sex, number[][]>;
  referenceHeight: Record<Sex, number>;
  referenceVolume: Record<Sex, number>;
  muscles: MuscleSectionMeta;
  bones: MeshSectionMeta;
  anchors: Record<MuscleGroup, { center: Record<Sex, number[]>; left: number; right: number }>;
  pick: { vertices: number; count: number; radius: number };
}

export interface MuscleAsset {
  meta: MuscleMeta;
  bin: ArrayBuffer;
}

export async function loadMuscles(): Promise<MuscleAsset> {
  const [metaResponse, binResponse] = await Promise.all([fetch("assets/muscles.json"), fetch("assets/muscles.bin")]);
  if (!metaResponse.ok || !binResponse.ok)
    throw new Error(`Could not load muscles: ${metaResponse.status}/${binResponse.status}`);
  const [meta, bin]: [MuscleMeta, ArrayBuffer] = await Promise.all([metaResponse.json(), binResponse.arrayBuffer()]);
  return { meta, bin };
}

export interface MuscleLevel {
  amount: number; // 0 quiet, 1 fully flushed
  color: THREE.Color;
}

export interface MuscleInput {
  visible: number; // 0 to 1: the whole figure, eased here
  shown: Partial<Record<MuscleGroup, number>>; // 0 to 1: one group on its own while the figure isn't up, eased here
  outlined: readonly MuscleGroup[]; // shown as lines only, with no fill
  palette: Palette;
  levels: Partial<Record<MuscleGroup, MuscleLevel>>;
  hover: MuscleGroup | null;
  focus: MuscleGroup | null;
}

export type BodySide = "left" | "right";

// What a ray met first. `group` is null for a muscle nobody names, which still blocks what is behind it.
export interface MusclePick {
  group: MuscleGroup | null;
  distance: number;
}

const BODY_DENSITY = 980; // kg per cubic metre, the figure's own mass-to-volume constant

const LOOK = {
  easeRate: 7, // same as the organs, so both respond together
  sexEaseRate: 6, // same as the stage's sex morph
  focusFade: 0.62, // how far other groups recede when one is focused
  focusPale: 0.45, // and how pale a focused group stays while it hasn't been worked, since grey reads as unwell
  hoverShown: 0.55, // a hovered group that isn't on screen comes up this far
  pickableFrom: 0.15, // a group fainter than this lets a click through
  drawnFrom: 0.003,
  outlineAlpha: 0.62, // lines between muscles stay lighter than the skin's own contour
  outlineSoften: 0.25, // and lean from the ink toward the paper
  hoverOutlineGain: 0.9,
  fineSpacing: 0.0017, // metres between engraved fibre lines seen close up
  bundleSpacing: 0.0068, // metres between the heavier fascicle lines that survive at distance
  lineStrength: 0.42,
  boneLiftDark: 0.2, // bones read brighter than muscle on the x-ray palette
  boneLiftLight: 0.22, // and warmer on the plate
  boneWarmth: "#f1e8d2",
};

// Draw order among transparent parts: after the organs, before the skin contour at 50. Each figure
// draws depth, then fill, then outline, so an outline is only ever inked over what it overlaps.
const ORDER = { bonesWhileFading: 34, muscles: 40, bonesOverMuscles: 43 };

// Pushes an outline just behind its own depth. Without it the back faces of a cut muscle would ink
// over its cut interior, where they sit at exactly the depth of the surface they are.
const OUTLINE_DEPTH_BIAS = 0.00001;

// Which child each joint stretches toward when the figure's proportions differ from the reference.
const BONE_CHILD: Record<string, string> = {
  hips: "spine",
  spine: "chest",
  chest: "neck",
  neck: "head",
  "clavicle.L": "arm.L",
  "arm.L": "forearm.L",
  "forearm.L": "hand.L",
  "clavicle.R": "arm.R",
  "arm.R": "forearm.R",
  "forearm.R": "hand.R",
  "thigh.L": "shin.L",
  "shin.L": "foot.L",
  "thigh.R": "shin.R",
  "shin.R": "foot.R",
};

// Every pass of a mesh has to land on exactly the same depth, or the depth pass and the fill speckle.
const SKIN_PARS = /* glsl */ `
  invariant gl_Position;
  #include <skinning_pars_vertex>
  attribute vec3 aPositionB;
  attribute vec3 aNormalB;
  uniform float uSexMix;
`;

// Both sexes live on one geometry, so the morph is a mix in the vertex shader.
const SKIN_BODY = /* glsl */ `
  vec3 objectNormal = mix(normal, aNormalB, uSexMix);
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = mix(position, aPositionB, uSexMix);
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
`;

const MUSCLE_VARYINGS = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec3 vTint;
  varying float vFibre;
  varying float vShade;
  varying float vTendon;
  varying float vAmount;
  varying float vHover;
  varying float vQuiet;
  varying float vOpacity;
  varying float vFill;
`;

const MUSCLE_VERT = /* glsl */ `
  ${SKIN_PARS}
  ${MUSCLE_VARYINGS}
  attribute float aGroup;
  attribute float aFibre;
  attribute float aShade;
  attribute float aTendon;
  uniform float uAmount[GROUP_COUNT];
  uniform vec3 uTint[GROUP_COUNT];
  uniform float uHover[GROUP_COUNT];
  uniform float uQuiet[GROUP_COUNT];
  uniform float uGroupOpacity[GROUP_COUNT];
  uniform float uGroupFill[GROUP_COUNT];
  void main() {
    int g = int(aGroup + 0.5);
    vFill = uGroupFill[g];
    vAmount = uAmount[g];
    vTint = uTint[g];
    vHover = uHover[g];
    vQuiet = uQuiet[g];
    vOpacity = uGroupOpacity[g];
    vFibre = aFibre;
    vShade = aShade;
    vTendon = aTendon;
    ${SKIN_BODY}
    vNormalV = normalize(normalMatrix * objectNormal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// An engraved plate: four hard-ish tones, with fibre lines that swell in shadow and thin out in
// light the way a burin line does. Lines fade by their own screen density, so a muscle reads as
// tone from afar and as fibres up close. Tendons stay pale and unlined.
const MUSCLE_FRAG = /* glsl */ `
  ${MUSCLE_VARYINGS}
  uniform vec3 uTone1;
  uniform vec3 uTone2;
  uniform vec3 uTone3;
  uniform vec3 uInk;
  uniform vec3 uCavity;
  uniform float uFineSpacing;
  uniform float uBundleSpacing;
  uniform float uLineStrength;

  // Coverage of one family of lines, from 0 to 1, for a given line half-width in periods.
  float lines(float coord, float halfWidth) {
    float w = fwidth(coord);
    float d = abs(fract(coord + 0.5) - 0.5);
    float line = 1.0 - smoothstep(halfWidth - w, halfWidth + w, d);
    return line * (1.0 - smoothstep(0.2, 0.46, w));
  }

  void main() {
    vec3 n = normalize(vNormalV);
    vec3 v = normalize(vViewDir);
    // A worked muscle takes one even wash of its colour, and any amount of it lifts the muscle off the
    // grey plate. Baked shading is left out of the wash, where it would read as bruises and bare spots.
    float washed = smoothstep(0.0, 0.25, vAmount);
    vec3 wash = mix(uTone1, vTint, clamp(vAmount * mix(1.0, 0.88, vTendon), 0.0, 1.0));
    if (!gl_FrontFacing) {
      gl_FragColor = vec4(mix(uCavity, wash * 0.92, washed), vOpacity * vFill);
      #include <colorspace_fragment>
      return;
    }
    float ndl = dot(n, normalize(vec3(-0.45, 0.75, 0.6)));
    float lit = ndl - (1.0 - vShade) * 1.05;
    float toTone1 = smoothstep(0.42, 0.49, lit);
    float toTone2 = smoothstep(-0.2, -0.13, lit);
    float toTone3 = smoothstep(-0.72, -0.65, lit);
    vec3 deep = mix(uTone3, uInk, 0.3);
    vec3 color = mix(deep, mix(uTone3, mix(uTone2, uTone1, toTone1), toTone2), toTone3);

    float shadow = 1.0 - clamp(mix(lit, ndl, washed) * 0.62 + 0.42, 0.0, 1.0);
    float fine = lines(vFibre / uFineSpacing, mix(0.07, 0.24, shadow));
    float bundle = lines(vFibre / uBundleSpacing, mix(0.035, 0.1, shadow));
    float belly = 1.0 - vTendon;
    float engraved = max(fine * 0.75, bundle) * belly * uLineStrength * mix(0.55, 1.0, shadow);

    // Tendon and aponeurosis: a pearly highlight.
    color = mix(color, mix(color, uTone1, 0.7), vTendon);

    color = mix(color, wash * mix(0.92, 1.03, smoothstep(-0.5, 0.7, ndl)), washed);
    vec3 lineInk = mix(uInk, vTint * 0.32, vAmount);
    color = mix(color, lineInk, engraved * (1.0 + vHover * 0.5) * (1.0 - vQuiet));

    float rim = 1.0 - clamp(dot(n, v), 0.0, 1.0);
    color = mix(color, mix(uInk, vTint * 0.6, washed), smoothstep(0.8, 1.0, rim) * 0.3);
    color = mix(color, mix(uInk, vTint, vAmount), vHover * 0.1);
    color = mix(color, uTone1, vQuiet);
    gl_FragColor = vec4(color, vOpacity * vFill);
    #include <colorspace_fragment>
  }
`;

const OUTLINE_VERT = /* glsl */ `
  ${SKIN_PARS}
  attribute float aGroup;
  uniform float uWidth;
  uniform float uHoverGain;
  uniform float uDepthBias;
  uniform vec2 uResolution;
  uniform float uHover[GROUP_COUNT];
  uniform float uQuiet[GROUP_COUNT];
  uniform float uGroupOpacity[GROUP_COUNT];
  varying float vQuiet;
  varying float vOpacity;
  void main() {
    int g = int(aGroup + 0.5);
    vQuiet = uQuiet[g];
    vOpacity = uGroupOpacity[g];
    ${SKIN_BODY}
    vec4 clip = projectionMatrix * mvPosition;
    vec3 nv = normalize(normalMatrix * objectNormal);
    vec2 nc = normalize((projectionMatrix * vec4(nv, 0.0)).xy + 1e-5);
    clip.xy += nc * uWidth * (1.0 + uHover[g] * uHoverGain) * 2.0 * clip.w / uResolution;
    clip.z += uDepthBias * clip.w;
    gl_Position = clip;
  }
`;

const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform float uAlpha;
  varying float vQuiet;
  varying float vOpacity;
  void main() {
    gl_FragColor = vec4(uInk, uAlpha * vOpacity * (1.0 - vQuiet * 0.72));
    #include <colorspace_fragment>
  }
`;

const DEPTH_VERT = /* glsl */ `
  ${SKIN_PARS}
  void main() {
    ${SKIN_BODY}
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const DEPTH_FRAG = /* glsl */ `
  void main() {
    gl_FragColor = vec4(0.0);
  }
`;

const BONE_VARYINGS = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying float vShade;
`;

const BONE_VERT = /* glsl */ `
  ${SKIN_PARS}
  ${BONE_VARYINGS}
  attribute float aShade;
  void main() {
    vShade = aShade;
    ${SKIN_BODY}
    vNormalV = normalize(normalMatrix * objectNormal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const BONE_FRAG = /* glsl */ `
  ${BONE_VARYINGS}
  uniform vec3 uTone1;
  uniform vec3 uTone2;
  uniform vec3 uTone3;
  uniform vec3 uInk;
  uniform vec3 uCavity;
  uniform float uOpacity;
  void main() {
    vec3 n = normalize(vNormalV);
    vec3 v = normalize(vViewDir);
    if (!gl_FrontFacing) {
      gl_FragColor = vec4(uCavity, uOpacity);
      #include <colorspace_fragment>
      return;
    }
    float lit = dot(n, normalize(vec3(-0.45, 0.75, 0.6))) - (1.0 - vShade) * 0.8;
    vec3 color = mix(uTone3, mix(uTone2, uTone1, smoothstep(0.34, 0.42, lit)), smoothstep(-0.24, -0.16, lit));
    float rim = 1.0 - clamp(dot(n, v), 0.0, 1.0);
    color = mix(color, uInk, smoothstep(0.78, 1.0, rim) * 0.34);
    gl_FragColor = vec4(color, uOpacity);
    #include <colorspace_fragment>
  }
`;

const BONE_OUTLINE_VERT = /* glsl */ `
  ${SKIN_PARS}
  uniform float uWidth;
  uniform float uDepthBias;
  uniform vec2 uResolution;
  void main() {
    ${SKIN_BODY}
    vec4 clip = projectionMatrix * mvPosition;
    vec3 nv = normalize(normalMatrix * objectNormal);
    vec2 nc = normalize((projectionMatrix * vec4(nv, 0.0)).xy + 1e-5);
    clip.xy += nc * uWidth * 2.0 * clip.w / uResolution;
    clip.z += uDepthBias * clip.w;
    gl_Position = clip;
  }
`;

const BONE_OUTLINE_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform float uAlpha;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uInk, uAlpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

function decodePositions(bin: ArrayBuffer, offset: number, vertexCount: number, quant: number): Float32Array {
  const q = new Int16Array(bin, offset, vertexCount * 3);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / quant;
  return out;
}

function smoothNormals(positions: Float32Array, index: Uint16Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      normals[k] += nx;
      normals[k + 1] += ny;
      normals[k + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

function buildSection(bin: ArrayBuffer, section: MeshSectionMeta, quant: number) {
  const index = new Uint16Array(bin, section.index, section.indexCount);
  const male = decodePositions(bin, section.positions.male, section.vertexCount, quant);
  const female = decodePositions(bin, section.positions.female, section.vertexCount, quant);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(male, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(smoothNormals(male, index), 3));
  geometry.setAttribute("aPositionB", new THREE.BufferAttribute(female, 3));
  geometry.setAttribute("aNormalB", new THREE.BufferAttribute(smoothNormals(female, index), 3));
  const skinIndex = new Uint8Array(bin, section.skinIndex, section.vertexCount * 4);
  const skinWeight = new Uint8Array(bin, section.skinWeight, section.vertexCount * 4);
  geometry.setAttribute("skinIndex", new THREE.Uint8BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Uint8BufferAttribute(skinWeight, 4, true));
  geometry.setAttribute(
    "aShade",
    new THREE.Uint8BufferAttribute(new Uint8Array(bin, section.shade, section.vertexCount), 1, true),
  );
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return { geometry, male, female, skinIndex, skinWeight };
}

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

const scratch = {
  rest: new THREE.Vector3(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  posed: new THREE.Vector3(),
};

// The bones minus the skull. A bare skull stares out of an otherwise quiet figure, and the skin's
// contour already draws the head.
function withoutSkull(section: ReturnType<typeof buildSection>, head: number) {
  const onHead = (vertex: number) => section.skinIndex[vertex * 4] === head && section.skinWeight[vertex * 4] >= 128;
  const index = section.geometry.getIndex();
  if (!index) throw new Error("The bones have no index");
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    if (!(onHead(a) && onHead(b) && onHead(c))) kept.push(a, b, c);
  }
  section.geometry.setIndex(new THREE.BufferAttribute(Uint16Array.from(kept), 1));
}

export class Muscles {
  readonly group = new THREE.Group();
  private readonly skeleton: THREE.Skeleton;
  private readonly bones: THREE.Bone[];
  private readonly referenceJoints: Record<Sex, THREE.Vector3[]>;
  private readonly childOf: number[];
  private readonly muscleSection: ReturnType<typeof buildSection>;
  private readonly muscleMaterial: THREE.ShaderMaterial;
  private readonly muscleOutlineMaterial: THREE.ShaderMaterial;
  private readonly muscleDepthMaterial: THREE.ShaderMaterial;
  private readonly boneMaterial: THREE.ShaderMaterial;
  private readonly boneOutlineMaterial: THREE.ShaderMaterial;
  private readonly boneDepthMaterial: THREE.ShaderMaterial;
  private readonly muscleMeshes: THREE.SkinnedMesh[];
  private readonly boneMeshes: THREE.SkinnedMesh[];
  private readonly amounts: Float32Array;
  private readonly tints: THREE.Color[];
  private readonly hovers: Float32Array;
  private readonly quiets: Float32Array;
  private readonly opacities: Float32Array;
  private readonly fills: Float32Array;
  private readonly groupNames: (MuscleGroup | null)[]; // null for the muscles nobody names
  private readonly groupTriangles: Uint16Array[];
  private readonly drawnIndex: Uint16Array;
  private readonly pickVertices: Uint16Array;
  private readonly pickGroup: Uint8Array;
  private readonly offsets: THREE.Matrix4[];
  private drawnGroups = -1;
  private inversesStale = true;
  private sex: Sex = "male";
  private sexMix = 0;
  private height = 1.8;
  private weightKg: number | null = null;
  private muscleOpacity = 0;
  private palette: Palette;

  constructor(
    private readonly asset: MuscleAsset,
    private readonly figure: Figure,
    palette: Palette,
    resolution: THREE.Vector2,
  ) {
    const { meta, bin } = asset;
    this.palette = palette;
    this.bones = meta.joints.map((name) => {
      const bone = figure.bones.get(name);
      if (!bone) throw new Error(`Figure has no joint ${name}`);
      return bone;
    });
    const toVectors = (rows: number[][]) => rows.map((r) => new THREE.Vector3().fromArray(r));
    this.referenceJoints = {
      male: toVectors(meta.referenceJoints.male),
      female: toVectors(meta.referenceJoints.female),
    };
    this.childOf = meta.joints.map((name) => {
      const child = BONE_CHILD[name];
      return child === undefined ? -1 : meta.joints.indexOf(child);
    });
    this.skeleton = new THREE.Skeleton(
      this.bones,
      this.bones.map(() => new THREE.Matrix4()),
    );
    this.offsets = this.bones.map(() => new THREE.Matrix4());

    const groupCount = meta.groups.length;
    this.amounts = new Float32Array(groupCount);
    this.tints = meta.groups.map(() => new THREE.Color("#ffffff"));
    this.hovers = new Float32Array(groupCount);
    this.quiets = new Float32Array(groupCount);
    this.opacities = new Float32Array(groupCount);
    this.fills = new Float32Array(groupCount).fill(1);
    this.groupNames = meta.groups.map((name) => MUSCLE_GROUPS.find((g) => g === name) ?? null);

    const shared = { uSexMix: { value: 0 } };
    const defines = { GROUP_COUNT: groupCount };
    const groupUniforms = {
      uHover: { value: this.hovers },
      uQuiet: { value: this.quiets },
      uGroupOpacity: { value: this.opacities },
    };

    // Muscles.
    this.muscleSection = buildSection(bin, meta.muscles, meta.quant);
    const muscleGeometry = this.muscleSection.geometry;
    const count = meta.muscles.vertexCount;
    muscleGeometry.setAttribute(
      "aGroup",
      new THREE.Uint8BufferAttribute(new Uint8Array(bin, meta.muscles.group, count), 1),
    );
    muscleGeometry.setAttribute(
      "aTendon",
      new THREE.Uint8BufferAttribute(new Uint8Array(bin, meta.muscles.tendon, count), 1, true),
    );
    const fibreQuantized = new Int16Array(bin, meta.muscles.fibre, count);
    const fibre = new Float32Array(count);
    for (let i = 0; i < count; i++) fibre[i] = fibreQuantized[i] / meta.muscles.fibreQuant;
    muscleGeometry.setAttribute("aFibre", new THREE.BufferAttribute(fibre, 1));

    // Triangles sorted by group, so only the groups on screen are ever drawn.
    const vertexGroup = new Uint8Array(bin, meta.muscles.group, count);
    const allTriangles = new Uint16Array(bin, meta.muscles.index, meta.muscles.indexCount);
    const byGroup: number[][] = meta.groups.map(() => []);
    for (let t = 0; t < allTriangles.length; t += 3)
      byGroup[vertexGroup[allTriangles[t]]].push(allTriangles[t], allTriangles[t + 1], allTriangles[t + 2]);
    this.groupTriangles = byGroup.map((triangles) => Uint16Array.from(triangles));
    this.drawnIndex = new Uint16Array(allTriangles.length);
    muscleGeometry.setIndex(new THREE.BufferAttribute(this.drawnIndex, 1).setUsage(THREE.DynamicDrawUsage));

    this.muscleMaterial = new THREE.ShaderMaterial({
      vertexShader: MUSCLE_VERT,
      fragmentShader: MUSCLE_FRAG,
      defines,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      side: THREE.DoubleSide,
      uniforms: {
        ...shared,
        ...groupUniforms,
        uGroupFill: { value: this.fills },
        uAmount: { value: this.amounts },
        uTint: { value: this.tints },
        uTone1: { value: new THREE.Color(palette.tone1) },
        uTone2: { value: new THREE.Color(palette.tone2) },
        uTone3: { value: new THREE.Color(palette.tone3) },
        uInk: { value: new THREE.Color(palette.ink) },
        uCavity: { value: new THREE.Color(palette.cavity) },
        uFineSpacing: { value: LOOK.fineSpacing },
        uBundleSpacing: { value: LOOK.bundleSpacing },
        uLineStrength: { value: LOOK.lineStrength },
      },
    });
    this.muscleOutlineMaterial = new THREE.ShaderMaterial({
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      defines,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        ...shared,
        ...groupUniforms,
        uInk: { value: new THREE.Color(palette.ink) },
        uAlpha: { value: LOOK.outlineAlpha },
        uWidth: hullCssPixels,
        uHoverGain: { value: LOOK.hoverOutlineGain },
        uDepthBias: { value: OUTLINE_DEPTH_BIAS },
        uResolution: { value: resolution },
      },
    });
    this.muscleDepthMaterial = this.depthMaterial(shared);
    this.muscleMeshes = this.addMeshes(muscleGeometry, [
      this.muscleDepthMaterial,
      this.muscleMaterial,
      this.muscleOutlineMaterial,
    ]);
    this.setDrawOrder(this.muscleMeshes, ORDER.muscles);

    // Bones.
    const boneSection = buildSection(bin, meta.bones, meta.quant);
    withoutSkull(boneSection, meta.joints.indexOf("head"));
    const boneOpacity = { uOpacity: { value: 0 } };
    this.boneMaterial = new THREE.ShaderMaterial({
      vertexShader: BONE_VERT,
      fragmentShader: BONE_FRAG,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      side: THREE.DoubleSide,
      uniforms: {
        ...shared,
        ...boneOpacity,
        uTone1: { value: new THREE.Color() },
        uTone2: { value: new THREE.Color() },
        uTone3: { value: new THREE.Color() },
        uInk: { value: new THREE.Color(palette.ink) },
        uCavity: { value: new THREE.Color(palette.cavity) },
      },
    });
    this.boneOutlineMaterial = new THREE.ShaderMaterial({
      vertexShader: BONE_OUTLINE_VERT,
      fragmentShader: BONE_OUTLINE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        ...shared,
        ...boneOpacity,
        uInk: { value: new THREE.Color(palette.ink) },
        uAlpha: { value: LOOK.outlineAlpha },
        uWidth: hullCssPixels,
        uDepthBias: { value: OUTLINE_DEPTH_BIAS },
        uResolution: { value: resolution },
      },
    });
    this.boneDepthMaterial = this.depthMaterial(shared);
    this.boneMeshes = this.addMeshes(boneSection.geometry, [
      this.boneDepthMaterial,
      this.boneMaterial,
      this.boneOutlineMaterial,
    ]);

    this.applyPalette(palette);

    this.pickVertices = new Uint16Array(bin, meta.pick.vertices, meta.pick.count);
    this.pickGroup = Uint8Array.from(this.pickVertices, (vertex) => vertexGroup[vertex]);
  }

  private depthMaterial(shared: { uSexMix: { value: number } }) {
    return new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      transparent: true,
      colorWrite: false,
      side: THREE.DoubleSide,
      // A fill has to pass against this depth, so leave it the last bit. Depth is rounded more
      // coarsely than one unit far from the camera, and more again on a steep surface.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 2,
      uniforms: { ...shared },
    });
  }

  private addMeshes(geometry: THREE.BufferGeometry, materials: THREE.Material[]) {
    return materials.map((material) => {
      const mesh = new THREE.SkinnedMesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.raycast = () => {}; // skinned triangles are far too slow to test; `pick` uses points
      mesh.bind(this.skeleton, new THREE.Matrix4());
      mesh.visible = false;
      this.group.add(mesh);
      return mesh;
    });
  }

  private setDrawOrder(meshes: THREE.SkinnedMesh[], start: number) {
    meshes.forEach((mesh, i) => {
      mesh.renderOrder = start + i;
    });
  }

  private applyPalette(palette: Palette) {
    this.palette = palette;
    const u = this.muscleMaterial.uniforms;
    u.uTone1.value.set(palette.tone1);
    u.uTone2.value.set(palette.tone2);
    u.uTone3.value.set(palette.tone3);
    u.uInk.value.set(palette.ink);
    u.uCavity.value.set(palette.cavity);
    const line = new THREE.Color(palette.ink).lerp(new THREE.Color(palette.tone2), LOOK.outlineSoften);
    this.muscleOutlineMaterial.uniforms.uInk.value.copy(line);
    const dark = luminance(palette.background) < 0.2;
    const lift = new THREE.Color(dark ? palette.ink : LOOK.boneWarmth);
    const amount = dark ? LOOK.boneLiftDark : LOOK.boneLiftLight;
    const b = this.boneMaterial.uniforms;
    b.uTone1.value.set(palette.tone1).lerp(lift, amount);
    b.uTone2.value.set(palette.tone2).lerp(lift, amount);
    b.uTone3.value.set(palette.tone3).lerp(lift, amount);
    b.uInk.value.set(palette.ink);
    b.uCavity.value.set(palette.cavity);
    this.boneOutlineMaterial.uniforms.uInk.value.copy(line);
  }

  setBody(sex: Sex, heightMetres: number, weightKg?: number) {
    this.sex = sex;
    this.height = heightMetres;
    this.weightKg = weightKg ?? null;
    this.inversesStale = true;
  }

  update(dt: number, input: MuscleInput) {
    if (input.palette !== this.palette) this.applyPalette(input.palette);
    const k = 1 - Math.exp(-dt * LOOK.easeRate);
    const sexTarget = this.sex === "female" ? 1 : 0;
    if (this.sexMix !== sexTarget) {
      this.sexMix += (sexTarget - this.sexMix) * (1 - Math.exp(-dt * LOOK.sexEaseRate));
      if (Math.abs(this.sexMix - sexTarget) < 0.002) this.sexMix = sexTarget;
      this.muscleMaterial.uniforms.uSexMix.value = this.sexMix;
      this.inversesStale = true;
    }
    if (this.inversesStale) {
      this.refreshInverses();
      this.inversesStale = false;
    }

    this.muscleOpacity = this.approach(this.muscleOpacity, input.visible, k);

    const focusNamed = input.focus !== null;
    this.groupNames.forEach((name, i) => {
      const shown = name === null ? 0 : (input.shown[name] ?? 0);
      const hovered = name !== null && name === input.hover;
      this.opacities[i] = this.approach(
        this.opacities[i],
        Math.max(input.visible, shown, hovered ? LOOK.hoverShown : 0),
        k,
      );
      this.fills[i] = this.approach(
        this.fills[i],
        name !== null && !hovered && input.outlined.includes(name) ? 0 : 1,
        k,
      );
      const level = name === null ? undefined : input.levels[name];
      this.amounts[i] += ((level ? level.amount : 0) - this.amounts[i]) * k;
      if (level) this.tints[i].lerp(level.color, k);
      this.hovers[i] += ((hovered ? 1 : 0) - this.hovers[i]) * k;
      const quiet = !focusNamed ? 0 : name === input.focus ? LOOK.focusPale * (1 - this.amounts[i]) : LOOK.focusFade;
      this.quiets[i] += (quiet - this.quiets[i]) * k;
    });
    const drawn = this.chooseDrawnGroups();
    for (const mesh of this.muscleMeshes) mesh.visible = drawn;

    // Where no muscle covers it, bone shows: hands, sternum, knees. So the muscle figure always
    // stands on its skeleton. A single group on its own brings no bones with it.
    this.boneMaterial.uniforms.uOpacity.value = this.muscleOpacity;
    for (const mesh of this.boneMeshes) mesh.visible = this.muscleOpacity > LOOK.drawnFrom;
    // Solid muscles let the bones ink over them; fading muscles need the bones already drawn behind.
    this.setDrawOrder(this.boneMeshes, this.muscleOpacity > 0.998 ? ORDER.bonesOverMuscles : ORDER.bonesWhileFading);
  }

  private approach(from: number, to: number, k: number) {
    const next = from + (to - from) * k;
    return Math.abs(next - to) < 0.002 ? to : next;
  }

  // Rewrites the index when the groups on screen change, so what isn't on screen costs nothing.
  private chooseDrawnGroups() {
    let mask = 0;
    this.opacities.forEach((opacity, i) => {
      if (opacity > LOOK.drawnFrom) mask |= 1 << i;
    });
    if (mask === this.drawnGroups) return mask !== 0;
    this.drawnGroups = mask;
    let written = 0;
    this.groupTriangles.forEach((triangles, i) => {
      if ((mask & (1 << i)) === 0) return;
      this.drawnIndex.set(triangles, written);
      written += triangles.length;
    });
    const geometry = this.muscleSection.geometry;
    geometry.setDrawRange(0, written);
    const index = geometry.getIndex();
    if (index) index.needsUpdate = true;
    return mask !== 0;
  }

  get boneInverses(): readonly THREE.Matrix4[] {
    return this.skeleton.boneInverses;
  }

  // World position of a group under the current pose. Paired groups sit on one side.
  anchorOf(group: MuscleGroup, out: THREE.Vector3, side: BodySide = "left"): THREE.Vector3 {
    const anchor = this.asset.meta.anchors[group];
    for (let j = 0; j < this.bones.length; j++)
      this.offsets[j].multiplyMatrices(this.bones[j].matrixWorld, this.skeleton.boneInverses[j]);
    return this.posedVertex(side === "left" ? anchor.left : anchor.right, out);
  }

  // What a ray meets first among the groups on screen, tested against a posed scatter of points near the skin.
  pick(raycaster: THREE.Raycaster): MusclePick | null {
    if (!this.opacities.some((opacity) => opacity >= LOOK.pickableFrom)) return null;
    for (let j = 0; j < this.bones.length; j++)
      this.offsets[j].multiplyMatrices(this.bones[j].matrixWorld, this.skeleton.boneInverses[j]);
    const { origin, direction } = raycaster.ray;
    const scale = this.height / this.mixedHeight();
    const radius = this.asset.meta.pick.radius * scale;
    let best = Infinity;
    let found = -1;
    for (let i = 0; i < this.pickVertices.length; i++) {
      if (this.opacities[this.pickGroup[i]] < LOOK.pickableFrom) continue;
      const q = this.posedVertex(this.pickVertices[i], scratch.posed);
      const along = (q.x - origin.x) * direction.x + (q.y - origin.y) * direction.y + (q.z - origin.z) * direction.z;
      if (along <= 0 || along >= best) continue;
      if (q.distanceToSquared(origin) - along * along > radius * radius) continue;
      best = along;
      found = this.pickGroup[i];
    }
    return found < 0 ? null : { group: this.groupNames[found], distance: best };
  }

  // A muscle vertex under the bone offsets last computed, the same sum the vertex shader does.
  private posedVertex(vertex: number, out: THREE.Vector3) {
    const { male, female, skinIndex, skinWeight } = this.muscleSection;
    const i = vertex * 3;
    const m = this.sexMix;
    scratch.rest.set(
      male[i] * (1 - m) + female[i] * m,
      male[i + 1] * (1 - m) + female[i + 1] * m,
      male[i + 2] * (1 - m) + female[i + 2] * m,
    );
    out.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight[vertex * 4 + k];
      if (weight === 0) break; // weights are stored heaviest first
      out.addScaledVector(
        scratch.a.copy(scratch.rest).applyMatrix4(this.offsets[skinIndex[vertex * 4 + k]]),
        weight / 255,
      );
    }
    return out;
  }

  private mixedHeight() {
    const { male, female } = this.asset.meta.referenceHeight;
    return male * (1 - this.sexMix) + female * this.sexMix;
  }

  // Each bone carries the reference mesh onto the figure's actual joints: stretched along the bone
  // to the figure's segment length, scaled across it to the body's height. With no pose applied,
  // a vertex ends up at joint + scale * (vertex - reference joint).
  private refreshInverses() {
    const { meta } = this.asset;
    const m = this.sexMix;
    const across = this.acrossScale();
    const current = this.figure.restJoints;
    const reference = (joint: number, out: THREE.Vector3) =>
      out.copy(this.referenceJoints.male[joint]).lerp(this.referenceJoints.female[joint], m);
    for (let i = 0; i < this.bones.length; i++) {
      const J = reference(i, scratch.a);
      const inverse = this.skeleton.boneInverses[i];
      const child = this.childOf[i];
      const here = current.get(meta.joints[i]);
      const there = child >= 0 ? current.get(meta.joints[child]) : undefined;
      if (here && there) {
        const axis = reference(child, scratch.b).sub(J);
        const referenceLength = axis.length();
        axis.divideScalar(referenceLength);
        const along = here.distanceTo(there) / referenceLength;
        const d = along - across;
        const x = axis.x;
        const y = axis.y;
        const z = axis.z;
        const e00 = across + d * x * x;
        const e01 = d * x * y;
        const e02 = d * x * z;
        const e11 = across + d * y * y;
        const e12 = d * y * z;
        const e22 = across + d * z * z;
        inverse.set(
          e00,
          e01,
          e02,
          -(e00 * J.x + e01 * J.y + e02 * J.z),
          e01,
          e11,
          e12,
          -(e01 * J.x + e11 * J.y + e12 * J.z),
          e02,
          e12,
          e22,
          -(e02 * J.x + e12 * J.y + e22 * J.z),
          0,
          0,
          0,
          1,
        );
      } else {
        const s = this.height / this.mixedHeight();
        inverse.set(s, 0, 0, -s * J.x, 0, s, 0, -s * J.y, 0, 0, s, -s * J.z, 0, 0, 0, 1);
      }
    }
  }

  // Across a limb, muscle follows height. A body thinner than the reference also narrows it, so it
  // stays under the skin; a heavier one keeps its muscle and gains the difference as soft tissue.
  private acrossScale() {
    const { referenceVolume } = this.asset.meta;
    const s = this.height / this.mixedHeight();
    if (this.weightKg === null) return s;
    const volume = (referenceVolume.male * (1 - this.sexMix) + referenceVolume.female * this.sexMix) * s * s * s;
    return s * Math.min(1, Math.sqrt(this.weightKg / BODY_DENSITY / volume));
  }
}
