import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Sex } from "../model/scenario";
import type { OrganMeta } from "./assets";
import { PALETTES } from "./materials";
import { firstPartOfIntestine, Stomach } from "./stomach";

const items = [{ color: new THREE.Color("#c08040"), count: 90 }];

function meshFrom(meta: OrganMeta, bin: ArrayBuffer, name: string) {
  const organ = meta.organs[name];
  const quantised = new Int16Array(bin, organ.pos, organ.vertexCount * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(quantised, (q) => q / meta.quant), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, organ.index, organ.indexCount), 1));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

// A point is inside a closed surface when a ray from it crosses that surface an odd number of times.
function isInside(mesh: THREE.Mesh, point: THREE.Vector3) {
  return new THREE.Raycaster(point, new THREE.Vector3(0.31, 0.77, 0.56).normalize()).intersectObject(mesh).length % 2 === 1;
}

function nearestVertex(mesh: THREE.Mesh, point: THREE.Vector3) {
  const positions = mesh.geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  let best = Infinity;
  for (let i = 0; i < positions.count; i++) best = Math.min(best, vertex.fromBufferAttribute(positions, i).distanceTo(point));
  return best;
}

beforeAll(() => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
});

describe.each<Sex>(["male", "female"])("food in the stomach of the %s body", (sex) => {
  const meta: OrganMeta = JSON.parse(readFileSync(`public/assets/organs-${sex}.json`, "utf8"));
  const file = readFileSync(`public/assets/organs-${sex}.bin`);
  const bin = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

  it("keeps every piece and its outline inside the stomach as a meal empties", () => {
    const stomach = new Stomach(meta, PALETTES.light, new THREE.Vector2(1000, 800));
    const outlines = stomach.group.children.find((child) => child instanceof THREE.InstancedMesh && child.material instanceof THREE.MeshBasicMaterial);
    if (!(outlines instanceof THREE.InstancedMesh)) throw new Error("The stomach has no piece outlines");
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const size = new THREE.Vector3();
    const spin = new THREE.Quaternion();
    let checked = 0;
    for (const volume of [900, 600, 460, 300, 180, 90]) {
      // Enough frames to settle on this volume and pass through a whole wave at the outlet.
      for (let frame = 0; frame < 45; frame++) {
        stomach.update(0.1, volume, new THREE.Color("#c08040"), 3, items, 4);
        if (frame < 30 || frame % 3 !== 0) continue;
        for (let n = 0; n < outlines.count; n++) {
          outlines.getMatrixAt(n, matrix);
          matrix.decompose(at, spin, size);
          const reach = Math.max(size.x, size.y, size.z);
          if (reach < 1e-3) continue;
          expect(isInside(stomach.wall, at)).toBe(true);
          expect(nearestVertex(stomach.wall, at)).toBeGreaterThanOrEqual(reach * 0.99);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 60000);

  it("sends leaving pieces along the inside of the first part of the intestine", () => {
    const duodenum = meshFrom(meta, bin, "duodenum");
    const [, ...path] = firstPartOfIntestine(meta, new THREE.Vector3());
    expect(path.length).toBeGreaterThan(4);
    expect(path.filter((point) => !isInside(duodenum, point))).toEqual([]);
  });
});
