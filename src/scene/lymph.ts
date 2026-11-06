import * as THREE from "three";
import type { Figure } from "./figure";
import { createNodeMaterial, Palette } from "./materials";

// Lymph nodes have no real geometry here, so they are drawn as what they are on this plate: small
// schematic marks in the places a doctor feels for them. Offsets are metres on a 1.8 m body, from
// the joint named, with the side given for the body's left and mirrored for the right.
export const LYMPH_CLUSTERS = ["neck", "armpit", "abdomen", "groin"] as const;
export type LymphCluster = (typeof LYMPH_CLUSTERS)[number];

const CLUSTERS: Record<
  LymphCluster,
  {
    joint: string;
    sided: boolean;
    both: boolean;
    offset: [number, number, number];
    spread: [number, number, number];
    count: number;
  }
> = {
  neck: {
    joint: "neck",
    sided: false,
    both: true,
    offset: [0.042, -0.012, 0.032],
    spread: [0.008, 0.026, 0.01],
    count: 3,
  },
  armpit: {
    joint: "arm",
    sided: true,
    both: true,
    offset: [-0.045, -0.085, 0.005],
    spread: [0.012, 0.018, 0.018],
    count: 3,
  },
  abdomen: {
    joint: "spine",
    sided: false,
    both: false,
    offset: [0.008, 0.02, 0.075],
    spread: [0.032, 0.04, 0.008],
    count: 5,
  },
  groin: {
    joint: "thigh",
    sided: true,
    both: true,
    offset: [-0.046, 0.016, 0.085],
    spread: [0.016, 0.01, 0.008],
    count: 3,
  },
};

const LOOK = { sizePx: 3.6, renderOrder: 33, easeRate: 7, reference: 1.8, quietOpacity: 0.42 };
const GOLDEN_ANGLE = 2.39996;

const jointOf = (cluster: LymphCluster, mirror: number) => {
  const { joint, sided } = CLUSTERS[cluster];
  return sided ? `${joint}.${mirror === 1 ? "L" : "R"}` : joint;
};

interface Node {
  joint: string;
  mirror: number;
  offset: THREE.Vector3;
}

function nodesOf(): Node[] {
  const nodes: Node[] = [];
  for (const name of LYMPH_CLUSTERS) {
    const cluster = CLUSTERS[name];
    for (const mirror of cluster.both ? [1, -1] : [1]) {
      for (let i = 0; i < cluster.count; i++) {
        // A sunflower spiral scatters a few marks evenly without looking like a grid.
        const reach = Math.sqrt((i + 0.5) / cluster.count);
        const angle = i * GOLDEN_ANGLE;
        nodes.push({
          joint: jointOf(name, mirror),
          mirror,
          offset: new THREE.Vector3(
            cluster.offset[0] + Math.cos(angle) * reach * cluster.spread[0],
            cluster.offset[1] + Math.sin(angle) * reach * cluster.spread[1],
            cluster.offset[2] + Math.cos(angle * 2) * reach * cluster.spread[2],
          ),
        });
      }
    }
  }
  return nodes;
}

export class LymphNodes {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly nodes = nodesOf();
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly joint = new THREE.Vector3();

  constructor(
    private readonly figure: Figure,
    private readonly pixelRatio: number,
  ) {
    this.positions = new Float32Array(this.nodes.length * 3);
    this.sizes = new Float32Array(this.nodes.length).fill(LOOK.sizePx);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.material = createNodeMaterial(pixelRatio);
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = LOOK.renderOrder;
    this.points.visible = false;
  }

  // Where a label for one cluster attaches. A pair answers with the body's left side.
  anchorOf(cluster: LymphCluster, out: THREE.Vector3) {
    const { offset } = CLUSTERS[cluster];
    const scale = this.figure.height / LOOK.reference;
    this.figure.worldJoint(jointOf(cluster, 1), out);
    return out.set(out.x + offset[0] * scale, out.y + offset[1] * scale, out.z + offset[2] * scale);
  }

  setSizeScale(scale: number) {
    this.material.uniforms.uPixelRatio.value = this.pixelRatio * scale;
  }

  setPalette(palette: Palette, tint: THREE.Color) {
    this.material.uniforms.uInk.value.set(palette.ink);
    this.material.uniforms.uTint.value.copy(tint);
  }

  // Nothing is placed or drawn while the marks aren't on screen.
  update(dt: number, shown: number, level: number) {
    const k = 1 - Math.exp(-dt * LOOK.easeRate);
    const u = this.material.uniforms;
    u.uOpacity.value += (shown * (LOOK.quietOpacity + (1 - LOOK.quietOpacity) * level) - u.uOpacity.value) * k;
    u.uLevel.value += (level - u.uLevel.value) * k;
    this.points.visible = u.uOpacity.value > 0.004;
    if (!this.points.visible) return;
    const scale = this.figure.height / LOOK.reference;
    this.nodes.forEach((node, i) => {
      this.figure.worldJoint(node.joint, this.joint);
      this.positions[i * 3] = this.joint.x + node.offset.x * scale * node.mirror;
      this.positions[i * 3 + 1] = this.joint.y + node.offset.y * scale;
      this.positions[i * 3 + 2] = this.joint.z + node.offset.z * scale;
    });
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
