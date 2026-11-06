import * as THREE from "three";
import type { Body, Sex } from "../model/scenario";
import type { BodyAsset, BodyDeltaName } from "./assets";
import { createShellMaterial, Palette } from "./materials";

interface Shape {
  base: Float32Array;
  deltas: Record<BodyDeltaName, Float32Array>;
  joints: Float32Array;
  jointDeltas: Record<BodyDeltaName, Float32Array>;
}

const ANGLE = {
  sit: {
    thigh: -86,
    shin: 86,
    // Solved against the skeleton so the hands rest on the thighs.
    arm: 2.5,
    armIn: -5,
    forearm: -17.5,
    forearmIn: 30,
    spine: 2,
    head: -2,
  },
} as const;

const REFERENCE_AGE = 25;
const AGE_SPAN = 65;
const HEIGHT_PHENOTYPE_STEP = 1; // deltas are stored per unit of the height phenotype

// Where belly fat shows on the skin: a soft band around the waist, sized from the torso's joints. It
// runs right round because the wash is carried by the far side of the skin.
const BELLY = {
  armBones: ["clavicle.L", "arm.L", "forearm.L", "hand.L", "clavicle.R", "arm.R", "forearm.R", "hand.R"],
  legBones: ["thigh.L", "thigh.R", "shin.L", "shin.R", "foot.L", "foot.R"],
  height: 0.42, // of the way from the hips up to the chest
  radiusY: 0.66, // of the hips-to-chest span
  radiusX: 2.7, // of the hip joint's distance from the midline
  legGain: 0.8,
} as const;

const HEAD_NORMAL_PASSES = 5;
const CHIN_MIDLINE = 0.012;
const SCRATCH = new THREE.Vector3();

// The mesh is mixed on the CPU because the weight solve needs real volumes anyway; only
// skinning runs on the GPU.
export class Figure {
  readonly group = new THREE.Group();
  readonly hips: THREE.Bone;
  readonly bones = new Map<string, THREE.Bone>();
  readonly restJoints = new Map<string, THREE.Vector3>();
  height = 1.8;
  referenceTorso = { male: { hips: new THREE.Vector3(), neck: new THREE.Vector3() }, female: { hips: new THREE.Vector3(), neck: new THREE.Vector3() } };
  private readonly shapes: Record<Sex, Shape>;
  private readonly shell: THREE.SkinnedMesh;
  private readonly shellBack: THREE.SkinnedMesh;
  private readonly shellMaterial: THREE.ShaderMaterial;
  private readonly shellBackMaterial: THREE.ShaderMaterial;
  private bellyShown = false;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions: Float32Array;
  private readonly indices: Uint16Array;
  private readonly boneList: THREE.Bone[] = [];
  private readonly jointNames: string[];
  private readonly parentOf: (string | null)[];
  private readonly current: Float32Array;
  private readonly currentJoints: Float32Array;
  private readonly scratchA: Float32Array;
  private readonly scratchJ: Float32Array;
  private readonly skeleton: THREE.Skeleton;
  private readonly belly: Float32Array;
  private readonly headWeight: Float32Array;
  private readonly headVertices: number[];
  private readonly headNeighbours: number[][];
  private headRest = { top: 0, chin: 0 }; // above and below the head joint, at rest
  private readonly armWeight: Float32Array;
  private readonly legWeight: Float32Array;
  private sit = 0;
  private walk = 0;
  private phase = 0;

  constructor(asset: BodyAsset, palette: Palette) {
    const { meta, bin } = asset;
    const n = meta.vertexCount;
    this.jointNames = meta.joints.map((j) => j.name);
    this.parentOf = meta.joints.map((j) => j.parent);
    this.indices = new Uint16Array(bin, meta.index, meta.indexCount);

    const decode = (offset: number) => {
      const q = new Int16Array(bin, offset, n * 3);
      const out = new Float32Array(n * 3);
      for (let i = 0; i < q.length; i++) out[i] = q[i] / meta.quant;
      return out;
    };
    const flatten = (rows: number[][]) => Float32Array.from(rows.flat());
    const shape = (sex: Sex): Shape => {
      const s = meta.sexes[sex];
      const names = Object.keys(s.deltas) as BodyDeltaName[];
      return {
        base: decode(s.base),
        joints: flatten(s.joints),
        deltas: Object.fromEntries(names.map((k) => [k, decode(s.deltas[k].offset)])) as Record<BodyDeltaName, Float32Array>,
        jointDeltas: Object.fromEntries(names.map((k) => [k, flatten(s.deltas[k].joints)])) as Record<BodyDeltaName, Float32Array>,
      };
    };
    this.shapes = { male: shape("male"), female: shape("female") };

    this.positions = new Float32Array(n * 3);
    this.current = new Float32Array(n * 3);
    this.scratchA = new Float32Array(n * 3);
    this.currentJoints = new Float32Array(this.jointNames.length * 3);
    this.scratchJ = new Float32Array(this.jointNames.length * 3);

    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute("skinIndex", new THREE.Uint8BufferAttribute(new Uint8Array(bin, meta.skinIndex, n * 4), 4));
    this.geometry.setAttribute("skinWeight", new THREE.Uint8BufferAttribute(new Uint8Array(bin, meta.skinWeight, n * 4), 4, true));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

    const skinIndex = new Uint8Array(bin, meta.skinIndex, n * 4);
    const skinWeight = new Uint8Array(bin, meta.skinWeight, n * 4);
    const weightOn = (bones: readonly string[]) => {
      const indices = new Set(bones.map((b) => this.jointNames.indexOf(b)));
      const out = new Float32Array(n);
      for (let v = 0; v < n; v++) {
        for (let w = 0; w < 4; w++) if (indices.has(skinIndex[v * 4 + w])) out[v] += skinWeight[v * 4 + w] / 255;
      }
      return out;
    };
    this.armWeight = weightOn(BELLY.armBones);
    this.legWeight = weightOn(BELLY.legBones);
    this.belly = new Float32Array(n);
    this.geometry.setAttribute("aBelly", new THREE.BufferAttribute(this.belly, 1));
    this.geometry.setAttribute("aOpening", new THREE.Uint8BufferAttribute(new Uint8Array(bin, meta.opening, n), 1, true));

    this.headWeight = weightOn(["head"]);
    this.headVertices = [];
    const neighbours = new Map<number, Set<number>>();
    for (let t = 0; t < this.indices.length; t += 3) {
      const corners = [this.indices[t], this.indices[t + 1], this.indices[t + 2]];
      for (const a of corners) {
        if (this.headWeight[a] <= 0) continue;
        let near = neighbours.get(a);
        if (!near) {
          near = new Set();
          neighbours.set(a, near);
        }
        for (const b of corners) if (b !== a) near.add(b);
      }
    }
    this.headNeighbours = [];
    for (const [vertex, near] of neighbours) {
      this.headVertices.push(vertex);
      this.headNeighbours.push([...near]);
    }

    for (const name of this.jointNames) {
      const bone = new THREE.Bone();
      bone.name = name;
      this.bones.set(name, bone);
      this.boneList.push(bone);
    }
    this.parentOf.forEach((parent, i) => {
      if (parent) this.bones.get(parent)!.add(this.boneList[i]);
    });
    this.hips = this.bones.get("hips")!;

    for (const sex of ["male", "female"] as Sex[]) {
      const shape = this.shapes[sex];
      const read = (name: string) => {
        const i = this.jointNames.indexOf(name) * 3;
        return new THREE.Vector3(shape.joints[i], shape.joints[i + 1], shape.joints[i + 2]);
      };
      this.referenceTorso[sex] = { hips: read("hips"), neck: read("neck") };
    }

    this.shellMaterial = createShellMaterial(palette, THREE.FrontSide, 1);
    this.shellBackMaterial = createShellMaterial(palette, THREE.BackSide, 0.4);
    this.shell = new THREE.SkinnedMesh(this.geometry, this.shellMaterial);
    this.shellBack = new THREE.SkinnedMesh(this.geometry, this.shellBackMaterial);
    this.shell.frustumCulled = false;
    this.shellBack.frustumCulled = false;
    this.shell.renderOrder = 50;
    this.shellBack.renderOrder = -5;
    this.group.add(this.hips);
    this.group.add(this.shellBack, this.shell);
    this.skeleton = new THREE.Skeleton(this.boneList);
    this.shell.bind(this.skeleton, new THREE.Matrix4());
    this.shellBack.bind(this.skeleton, new THREE.Matrix4());
  }

  // The contour's colour: the ink of the plate, warmed by a fever.
  setContourColor(color: THREE.Color) {
    for (const material of [this.shellMaterial, this.shellBackMaterial]) material.uniforms.uInk.value.copy(color);
  }

  setShellOpacity(front: number, back: number) {
    this.shellMaterial.uniforms.uOpacity.value = front;
    this.shellBackMaterial.uniforms.uOpacity.value = back;
    this.syncShellVisibility();
  }

  setBelly(amount: number, color: THREE.Color) {
    for (const material of [this.shellMaterial, this.shellBackMaterial]) {
      material.uniforms.uBellyAmount.value = amount;
      material.uniforms.uBellyColor.value.copy(color);
    }
    this.bellyShown = amount > 0.003;
    this.syncShellVisibility();
  }

  private syncShellVisibility() {
    this.shell.visible = this.bellyShown || this.shellMaterial.uniforms.uOpacity.value > 0.003;
    this.shellBack.visible = this.bellyShown || this.shellBackMaterial.uniforms.uOpacity.value > 0.003;
  }

  private placeBelly() {
    const hips = this.jointAt("hips");
    const chest = this.jointAt("chest");
    const span = chest.y - hips.y;
    const centerY = hips.y + span * BELLY.height;
    const radiusY = span * BELLY.radiusY;
    const radiusX = Math.abs(this.jointAt("thigh.L").x) * BELLY.radiusX;
    const p = this.positions;
    for (let v = 0; v < this.armWeight.length; v++) {
      const dx = p[v * 3] / radiusX;
      const dy = (p[v * 3 + 1] - centerY) / radiusY;
      const onTorso = (1 - Math.min(1, this.armWeight[v])) * (1 - Math.min(1, this.legWeight[v]) * BELLY.legGain);
      this.belly[v] = Math.exp(-(dx * dx + dy * dy)) * onTorso;
    }
    this.geometry.attributes.aBelly.needsUpdate = true;
  }

  private mix(sex: Sex, weight: number, heightWeight: number, ageWeight: number, out: Float32Array, outJoints: Float32Array) {
    const s = this.shapes[sex];
    const up = s.deltas.weight_up;
    const down = s.deltas.weight_down;
    const hUp = s.deltas.height_up;
    const hDown = s.deltas.height_down;
    const age = s.deltas.age_up;
    const wUp = Math.max(0, weight);
    const wDown = Math.max(0, -weight);
    const hu = Math.max(0, heightWeight);
    const hd = Math.max(0, -heightWeight);
    for (let i = 0; i < out.length; i++) out[i] = s.base[i] + up[i] * wUp + down[i] * wDown + hUp[i] * hu + hDown[i] * hd + age[i] * ageWeight;
    const jUp = s.jointDeltas.weight_up;
    const jDown = s.jointDeltas.weight_down;
    const jhUp = s.jointDeltas.height_up;
    const jhDown = s.jointDeltas.height_down;
    const jAge = s.jointDeltas.age_up;
    for (let i = 0; i < outJoints.length; i++) outJoints[i] = s.joints[i] + jUp[i] * wUp + jDown[i] * wDown + jhUp[i] * hu + jhDown[i] * hd + jAge[i] * ageWeight;
  }

  private topOf(positions: Float32Array) {
    let max = -Infinity;
    for (let i = 1; i < positions.length; i += 3) if (positions[i] > max) max = positions[i];
    return max;
  }

  private bottomOf(positions: Float32Array) {
    let min = Infinity;
    for (let i = 1; i < positions.length; i += 3) if (positions[i] < min) min = positions[i];
    return min;
  }

  private volumeOf(p: Float32Array) {
    let v = 0;
    const ind = this.indices;
    for (let i = 0; i < ind.length; i += 3) {
      const a = ind[i] * 3;
      const b = ind[i + 1] * 3;
      const c = ind[i + 2] * 3;
      v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return Math.abs(v / 6);
  }

  // Solves the shape for a body: the height phenotype takes care of proportions, a final uniform
  // scale lands on the exact height, and the weight blend is searched against true mesh volume.
  setBody(body: Body, sexMix: number) {
    const a = (body.age - REFERENCE_AGE) / AGE_SPAN;
    const ageWeight = Math.max(-0.1, a);
    const target = body.heightCm / 100;
    const massTarget = body.weightKg / 980;

    const solveFor = (sex: Sex, out: Float32Array, outJoints: Float32Array) => {
      const s = this.shapes[sex];
      this.mix(sex, 0, 0, ageWeight, out, outJoints);
      const h0 = this.topOf(out);
      this.mix(sex, 0, HEIGHT_PHENOTYPE_STEP, ageWeight, out, outJoints);
      const slope = this.topOf(out) - h0;
      const heightWeight = (target - h0) / slope;

      const evaluate = (w: number) => {
        this.mix(sex, w, heightWeight, ageWeight, out, outJoints);
        const bottom = this.bottomOf(out);
        const scale = target / (this.topOf(out) - bottom);
        return this.volumeOf(out) * scale ** 3;
      };
      let w0 = 0;
      let w1 = 1;
      let v0 = evaluate(w0);
      let v1 = evaluate(w1);
      for (let i = 0; i < 3 && Math.abs(v1 - v0) > 1e-7; i++) {
        const w2 = Math.max(-1.2, Math.min(2.6, w1 + ((massTarget - v1) * (w1 - w0)) / (v1 - v0)));
        w0 = w1;
        v0 = v1;
        w1 = w2;
        v1 = evaluate(w1);
      }
      this.mix(sex, w1, heightWeight, ageWeight, out, outJoints);
      const bottom = this.bottomOf(out);
      const scale = target / (this.topOf(out) - bottom);
      for (let i = 0; i < out.length; i += 3) {
        out[i] *= scale;
        out[i + 1] = (out[i + 1] - bottom) * scale;
        out[i + 2] *= scale;
      }
      for (let i = 0; i < outJoints.length; i += 3) {
        outJoints[i] *= scale;
        outJoints[i + 1] = (outJoints[i + 1] - bottom) * scale;
        outJoints[i + 2] *= scale;
      }
      // The weight blend saturates at very low and very high BMI; a girth-only scale makes up the rest.
      const girth = Math.sqrt(massTarget / this.volumeOf(out));
      for (let i = 0; i < out.length; i += 3) {
        out[i] *= girth;
        out[i + 2] *= girth;
      }
      for (let i = 0; i < outJoints.length; i += 3) {
        outJoints[i] *= girth;
        outJoints[i + 2] *= girth;
      }
      return s;
    };

    solveFor("male", this.current, this.currentJoints);
    solveFor("female", this.scratchA, this.scratchJ);
    for (let i = 0; i < this.positions.length; i++) this.positions[i] = this.current[i] * (1 - sexMix) + this.scratchA[i] * sexMix;
    for (let i = 0; i < this.currentJoints.length; i++) this.currentJoints[i] = this.currentJoints[i] * (1 - sexMix) + this.scratchJ[i] * sexMix;

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.calmHeadNormals();
    this.geometry.computeBoundingSphere();
    this.height = target;
    this.rebindSkeleton();
    this.placeBelly();
    this.measureHead();
    this.applyPose();
  }

  // The contour follows the surface normals, so every fold of the face would draw a line. With the
  // head's normals averaged over the mesh, only its large outline does.
  private calmHeadNormals() {
    const attribute = this.geometry.getAttribute("normal");
    if (!(attribute instanceof THREE.BufferAttribute)) throw new Error("The body has no normals");
    const normals = attribute.array;
    const original = Float32Array.from(normals);
    const next = new Float32Array(this.headVertices.length * 3);
    for (let pass = 0; pass < HEAD_NORMAL_PASSES; pass++) {
      this.headVertices.forEach((vertex, i) => {
        let x = normals[vertex * 3];
        let y = normals[vertex * 3 + 1];
        let z = normals[vertex * 3 + 2];
        for (const near of this.headNeighbours[i]) {
          x += normals[near * 3];
          y += normals[near * 3 + 1];
          z += normals[near * 3 + 2];
        }
        const length = Math.hypot(x, y, z) || 1;
        next[i * 3] = x / length;
        next[i * 3 + 1] = y / length;
        next[i * 3 + 2] = z / length;
      });
      this.headVertices.forEach((vertex, i) => {
        normals[vertex * 3] = next[i * 3];
        normals[vertex * 3 + 1] = next[i * 3 + 1];
        normals[vertex * 3 + 2] = next[i * 3 + 2];
      });
    }
    // Back to the true normal where the head weight runs out, so nothing shows at the neck.
    for (const vertex of this.headVertices) {
      const w = this.headWeight[vertex];
      for (let k = 0; k < 3; k++) normals[vertex * 3 + k] = original[vertex * 3 + k] * (1 - w) + normals[vertex * 3 + k] * w;
    }
  }

  private measureHead() {
    const joint = this.jointAt("head");
    const p = this.positions;
    let top = -Infinity;
    let chin = Infinity;
    for (const vertex of this.headVertices) {
      if (this.headWeight[vertex] < 0.9) continue;
      const y = p[vertex * 3 + 1];
      top = Math.max(top, y);
      // The chin is the lowest point of the face on the midline.
      if (Math.abs(p[vertex * 3]) < CHIN_MIDLINE && p[vertex * 3 + 2] > joint.z) chin = Math.min(chin, y);
    }
    this.headRest = { top: top - joint.y, chin: chin - joint.y };
  }

  // Heights of the top of the head and the chin in the current pose.
  headHeights(out: { top: number; chin: number }) {
    const y = this.worldJoint("head", SCRATCH).y;
    out.top = y + this.headRest.top;
    out.chin = y + this.headRest.chin;
    return out;
  }

  private jointAt(name: string, out = new THREE.Vector3()) {
    const i = this.jointNames.indexOf(name) * 3;
    return out.set(this.currentJoints[i], this.currentJoints[i + 1], this.currentJoints[i + 2]);
  }

  private rebindSkeleton() {
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    this.jointNames.forEach((name, i) => {
      const bone = this.boneList[i];
      this.jointAt(name, v);
      const parent = this.parentOf[i];
      if (parent) bone.position.copy(v.sub(this.jointAt(parent, p)));
      else bone.position.copy(v);
      bone.rotation.set(0, 0, 0);
      this.restJoints.set(name, this.jointAt(name));
    });
    this.group.updateMatrixWorld(true);
    this.skeleton.calculateInverses();
  }

  setPose(sit: number, walk: number, phase: number) {
    this.sit = sit;
    this.walk = walk;
    this.phase = phase;
    this.applyPose();
  }

  private applyPose() {
    const k = this.sit;
    const w = this.walk * (1 - k);
    const rad = THREE.MathUtils.degToRad;
    const swing = Math.sin(this.phase);
    const lift = Math.max(0, Math.sin(this.phase + 1.2));
    const liftR = Math.max(0, Math.sin(this.phase + 1.2 + Math.PI));
    const a = ANGLE.sit;
    // Y last, so a forearm swung forward then turns toward the midline instead of twisting about itself.
    const set = (name: string, x: number, y = 0, z = 0) => this.bones.get(name)!.rotation.set(rad(x), rad(y), rad(z), "YXZ");
    set("thigh.L", a.thigh * k + 22 * swing * w);
    set("thigh.R", a.thigh * k - 22 * swing * w);
    set("shin.L", a.shin * k + 34 * lift * w);
    set("shin.R", a.shin * k + 34 * liftR * w);
    set("spine", a.spine * k + 1.5 * w);
    set("head", a.head * k);
    set("arm.L", a.arm * k - 15 * swing * w, 0, -a.armIn * k);
    set("arm.R", a.arm * k + 15 * swing * w, 0, a.armIn * k);
    set("forearm.L", a.forearm * k - 14 * w, -a.forearmIn * k);
    set("forearm.R", a.forearm * k - 14 * w, a.forearmIn * k);
    // Lowered so the feet stay on the floor; hips drop by what the bent legs no longer span.
    const thighLength = this.restJoints.get("shin.L")!.distanceTo(this.restJoints.get("thigh.L")!);
    const hipRest = this.restJoints.get("hips")!;
    this.hips.position.set(hipRest.x, hipRest.y - thighLength * k * 0.98 - 0.008 * w * Math.abs(swing), hipRest.z);
    this.group.updateMatrixWorld(true);
  }

  worldJoint(name: string, out = new THREE.Vector3()) {
    return this.bones.get(name)!.getWorldPosition(out);
  }
}
