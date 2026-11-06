import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CrossedPart, TrackFrom } from "../src/model/events";
import type { Sex } from "../src/model/scenario";
import type { OrganId } from "../src/model/ids";

// Which real organs and vessels a straight line crosses, tested against the atlas meshes the body is drawn
// from. Claude says where a track goes, and this says what is in its way, so the words can't drift from the anatomy.

type Point = [number, number, number];

interface Atlas {
  quant: number;
  organs: Record<string, { pos: number; vertexCount: number; index: number; indexCount: number; center: Point }>;
  centerlines: Record<string, Point[]>;
  vesselRadius: Record<string, number>;
  landmarks: Record<string, Point>;
}

// Which way each side of the body faces, in the atlas: the person's left is +x, up is +y, and the front is +z.
const SIDE: Record<TrackFrom, Point> = { front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0], above: [0, 1, 0], below: [0, -1, 0] };

const MESHES: Record<string, { organ: OrganId | null; name: string }> = {
  brain: { organ: "brain", name: "brain" },
  heart: { organ: "heart", name: "heart" },
  liver: { organ: "liver", name: "liver" },
  lung_L: { organ: "lungs", name: "left lung" },
  lung_R: { organ: "lungs", name: "right lung" },
  kidney_L: { organ: "kidneys", name: "left kidney" },
  kidney_R: { organ: "kidneys", name: "right kidney" },
  pancreas: { organ: "pancreas", name: "pancreas" },
  spleen: { organ: "spleen", name: "spleen" },
  duodenum: { organ: "small_intestine", name: "duodenum" },
  small_intestine: { organ: "small_intestine", name: "small intestine" },
  large_intestine: { organ: "large_intestine", name: "large intestine" },
  bladder: { organ: "bladder", name: "bladder" },
  prostate: { organ: "prostate", name: "prostate" },
  uterus: { organ: "uterus", name: "uterus" },
  ovary_L: { organ: "ovaries", name: "left ovary" },
  ovary_R: { organ: "ovaries", name: "right ovary" },
  spinal_cord: { organ: null, name: "spinal cord" },
};
const AIM_MESHES: Partial<Record<OrganId, string[]>> = { lungs: ["lung_R", "lung_L"], kidneys: ["kidney_R", "kidney_L"], ovaries: ["ovary_R", "ovary_L"] };
const OUTSIDE_BODY = 0.7; // metres back from the organ's centre, well outside the skin
const LINE_LENGTH = OUTSIDE_BODY * 2;
const VESSEL_MARGIN = 0.004;
const LEAST_VESSEL_RADIUS = 0.0035; // smaller named branches are everywhere, and naming them says nothing
const MOST_VESSELS = 6;
// The atlas has no stomach mesh, because the app builds one that changes with what is in it. It lies against
// these two surfaces.
const STOMACH = { touches: ["gastric_impression_of_liver", "gastric_surface_of_spleen"], radius: 0.055 };

const loaded = new Map<Sex, { atlas: Atlas; bin: ArrayBuffer }>();

function load(sex: Sex) {
  const known = loaded.get(sex);
  if (known) return known;
  const path = (extension: string) => resolve(process.cwd(), `public/assets/organs-${sex}.${extension}`);
  const file = readFileSync(path("bin"));
  const entry = { atlas: JSON.parse(readFileSync(path("json"), "utf8")) as Atlas, bin: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) };
  loaded.set(sex, entry);
  return entry;
}

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const along = (origin: Point, direction: Point, distance: number): Point => [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance, origin[2] + direction[2] * distance];

// How far along the line it first meets a triangle (Moller and Trumbore), or null.
function hitTriangle(origin: Point, direction: Point, a: Point, b: Point, c: Point): number | null {
  const edge1 = sub(b, a);
  const edge2 = sub(c, a);
  const p = cross(direction, edge2);
  const det = dot(edge1, p);
  if (Math.abs(det) < 1e-12) return null;
  const toOrigin = sub(origin, a);
  const u = dot(toOrigin, p) / det;
  if (u < 0 || u > 1) return null;
  const q = cross(toOrigin, edge1);
  const v = dot(direction, q) / det;
  if (v < 0 || u + v > 1) return null;
  const distance = dot(edge2, q) / det;
  return distance >= 0 ? distance : null;
}

function firstHit({ atlas, bin }: { atlas: Atlas; bin: ArrayBuffer }, mesh: string, origin: Point, direction: Point): number | null {
  const meta = atlas.organs[mesh];
  if (!meta) return null;
  const positions = new Int16Array(bin, meta.pos, meta.vertexCount * 3);
  const indices = new Uint32Array(bin, meta.index, meta.indexCount);
  const vertex = (i: number): Point => [positions[i * 3] / atlas.quant, positions[i * 3 + 1] / atlas.quant, positions[i * 3 + 2] / atlas.quant];
  let best: number | null = null;
  for (let t = 0; t < indices.length; t += 3) {
    const distance = hitTriangle(origin, direction, vertex(indices[t]), vertex(indices[t + 1]), vertex(indices[t + 2]));
    if (distance !== null && (best === null || distance < best)) best = distance;
  }
  return best;
}

function nearestOnSegment(origin: Point, direction: Point, a: Point, b: Point) {
  const steps = 6;
  let best = { apart: Infinity, distance: 0 };
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const point: Point = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const distance = dot(sub(point, origin), direction);
    const apart = Math.hypot(...sub(point, along(origin, direction, distance)));
    if (apart < best.apart) best = { apart, distance };
  }
  return best;
}

const vesselName = (id: string) => id.replace(/_(a|b|sup|inf)$/, "").replace(/_L$/, " left").replace(/_R$/, " right").replaceAll("_", " ");

function aimCenter(atlas: Atlas, aim: OrganId): Point | null {
  if (aim === "stomach") {
    const [a, b] = STOMACH.touches.map((name) => atlas.landmarks[name]);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  }
  const mesh = AIM_MESHES[aim]?.[0] ?? aim;
  return atlas.organs[mesh]?.center ?? null;
}

// Everything the line through this organ from this side crosses, in the order it reaches them.
export function traceTrack(aim: OrganId, from: TrackFrom, sex: Sex): CrossedPart[] {
  const entry = load(sex);
  const { atlas } = entry;
  const center = aimCenter(atlas, aim);
  if (!center) return [];
  const side = SIDE[from];
  const origin = along(center, side, OUTSIDE_BODY);
  const direction: Point = [-side[0], -side[1], -side[2]];
  const crossed: (CrossedPart & { distance: number })[] = [];
  for (const [mesh, part] of Object.entries(MESHES)) {
    const distance = firstHit(entry, mesh, origin, direction);
    if (distance !== null && distance <= LINE_LENGTH) crossed.push({ ...part, distance });
  }
  const [a, b] = STOMACH.touches.map((name) => atlas.landmarks[name]);
  const stomach: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const closest = dot(sub(stomach, origin), direction);
  if (Math.hypot(...sub(stomach, along(origin, direction, closest))) <= STOMACH.radius) crossed.push({ organ: "stomach", name: "stomach", distance: closest });

  const vessels = new Map<string, { radius: number; distance: number }>();
  for (const [id, radius] of Object.entries(atlas.vesselRadius)) {
    if (radius < LEAST_VESSEL_RADIUS) continue;
    const line = atlas.centerlines[id];
    if (!line) continue;
    for (let i = 1; i < line.length; i++) {
      const near = nearestOnSegment(origin, direction, line[i - 1], line[i]);
      if (near.apart > radius + VESSEL_MARGIN) continue;
      const name = vesselName(id);
      const seen = vessels.get(name);
      if (!seen || near.distance < seen.distance) vessels.set(name, { radius, distance: near.distance });
      break;
    }
  }
  const largest = [...vessels.entries()].sort((x, y) => y[1].radius - x[1].radius).slice(0, MOST_VESSELS);
  for (const [name, { distance }] of largest) crossed.push({ organ: null, name, distance });

  return crossed.sort((x, y) => x.distance - y.distance).map(({ organ, name }) => ({ organ, name }));
}
