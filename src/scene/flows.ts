import * as THREE from "three";
import type { RouteId } from "../model/processes";
import type { OrganMeta } from "./assets";

export type Line = THREE.Vector3[];

export interface Route {
  id: RouteId;
  points: Line;
  // A trunk can be joined and left anywhere along it. Every other route runs end to end.
  trunk: boolean;
  // What leads here. A line arriving from elsewhere in the body rides these first, so a branch of
  // the aorta is reached down the aorta and not straight through the chest.
  feeders: RouteId[];
}

// One unbroken run of a process line. A stop's line forks when its routes name both sides of a pair.
export interface Strand {
  path: Line;
  lengths: number[];
  total: number;
  startsAt: number; // how far along the stop's line this strand begins, so a fork draws in step
}

const SMOOTHING = {
  spacing: 0.005, // metres between samples on a finished line
  vesselPasses: 10,
  gutPasses: 60,
  bowelPasses: 2, // the small intestine's path already runs down the middle of its tube
  pathPasses: 6,
} as const;

const ARC_FROM = 0.002; // metres: nearer than this, two stops are one place
const ARC = { bow: 0.22, forward: 0.08, leastSamples: 12 };
const FRONT = new THREE.Vector3(0, 0, 1);
const FEEDER_REACH = 0.035; // metres: arriving nearer than this, a route needs no way in
const SHARED_WITHIN = 0.002; // metres: fork strands closer than this are still one line

const toLine = (raw: number[][]): Line => raw.map((p) => new THREE.Vector3(p[0], p[1], p[2]));

function lineLength(line: Line) {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += line[i].distanceTo(line[i - 1]);
  return total;
}

function nearestIndex(line: Line, to: THREE.Vector3) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < line.length; i++) {
    const d = line[i].distanceToSquared(to);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

// Evenly spaced samples along a polyline, ends kept.
function resample(line: Line, spacing: number): Line {
  const total = lineLength(line);
  const count = Math.max(1, Math.round(total / spacing));
  const out: Line = [line[0].clone()];
  let leg = 1;
  let walked = 0;
  for (let i = 1; i < count; i++) {
    const at = (total * i) / count;
    while (leg < line.length - 1 && walked + line[leg].distanceTo(line[leg - 1]) < at) {
      walked += line[leg].distanceTo(line[leg - 1]);
      leg++;
    }
    const span = line[leg].distanceTo(line[leg - 1]) || 1;
    out.push(line[leg - 1].clone().lerp(line[leg], (at - walked) / span));
  }
  out.push(line[line.length - 1].clone());
  return out;
}

// Vessel skeletons come out of a voxel grid, so they stair-step. This irons them flat without
// moving the ends, which is what lets one line pick up exactly where another stopped.
function smoothLine(line: Line, passes: number): Line {
  if (line.length < 2) return line.map((p) => p.clone());
  const even = resample(line, SMOOTHING.spacing);
  const scratch = even.map((p) => p.clone());
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 1; i < even.length - 1; i++) {
      scratch[i].copy(even[i]).multiplyScalar(2).add(even[i - 1]).add(even[i + 1]).multiplyScalar(0.25);
    }
    for (let i = 1; i < even.length - 1; i++) even[i].copy(scratch[i]);
  }
  return even;
}

// Skeletons of a short vessel piece often run down one wall and back up the other. Keeps the longer run.
function unfold(line: Line): Line {
  if (line.length < 4) return line;
  const first = line[0];
  const last = line[line.length - 1];
  if (first.distanceTo(last) > lineLength(line) * 0.6) return line;
  let tip = 0;
  let farthest = -1;
  for (let i = 0; i < line.length; i++) {
    const d = line[i].distanceToSquared(first) + line[i].distanceToSquared(last);
    if (d > farthest) {
      farthest = d;
      tip = i;
    }
  }
  const before = line.slice(0, tip + 1);
  const after = line.slice(tip);
  return lineLength(before) >= lineLength(after) ? before : after;
}

// Stops at the point farthest from the start, dropping any curl at the far end.
function trimCurl(line: Line): Line {
  let far = 0;
  let farthest = -1;
  for (let i = 0; i < line.length; i++) {
    const d = line[i].distanceToSquared(line[0]);
    if (d >= farthest) {
      farthest = d;
      far = i;
    }
  }
  return line.slice(0, far + 1);
}

type Step = string | THREE.Vector3 | Line;

// Walks steps end to end, turning each named centerline to continue from where the walk stands.
// Each reference body annotates a slightly different set of small vessels, so a name one body
// lacks drops out and the walk carries straight on to its next step.
function walker(meta: OrganMeta, tidy: boolean) {
  return (start: THREE.Vector3, steps: Step[]): Line => {
    const out: Line = [start];
    for (const step of steps) {
      if (step instanceof THREE.Vector3) {
        out.push(step);
        continue;
      }
      if (Array.isArray(step)) {
        out.push(...step);
        continue;
      }
      const raw = meta.centerlines[step];
      if (!raw) continue;
      const line = tidy ? unfold(toLine(raw)) : toLine(raw);
      const from = out[out.length - 1];
      const facing = from.distanceToSquared(line[0]) > from.distanceToSquared(line[line.length - 1]) ? [...line].reverse() : line;
      out.push(...(tidy ? trimCurl(facing) : facing));
    }
    return out;
  };
}

function endpointNearest(raw: number[][], to: THREE.Vector3) {
  const line = toLine(raw);
  const a = line[0];
  const b = line[line.length - 1];
  return a.distanceToSquared(to) < b.distanceToSquared(to) ? a : b;
}

// Which of several named centerlines reaches closest to a point. The male reference body swaps the
// labels on its renal arteries, so the side has to come from where the vessel actually goes.
function closestByReach(meta: OrganMeta, names: string[], to: THREE.Vector3): string {
  let best = names[0];
  let bestDistance = Infinity;
  for (const name of names) {
    const raw = meta.centerlines[name];
    if (!raw) continue;
    const d = endpointNearest(raw, to).distanceToSquared(to);
    if (d < bestDistance) {
      bestDistance = d;
      best = name;
    }
  }
  return best;
}

// The point on a trunk where a named branch comes off it.
function rootOn(trunk: Line, raw: number[][]): THREE.Vector3 {
  const line = toLine(raw);
  const a = trunk[nearestIndex(trunk, line[0])];
  const b = trunk[nearestIndex(trunk, line[line.length - 1])];
  return a.distanceToSquared(line[0]) < b.distanceToSquared(line[line.length - 1]) ? a : b;
}

function extreme(raw: number[][], pick: "lowest" | "highest"): THREE.Vector3 {
  const line = toLine(raw);
  return line.reduce((best, p) => ((pick === "lowest" ? p.y < best.y : p.y > best.y) ? p : best));
}

function buildRoutes(meta: OrganMeta, stomachPath: THREE.Curve<THREE.Vector3>, esophagusPath: THREE.Curve<THREE.Vector3>): Record<RouteId, Route> {
  const lm = (name: string) => new THREE.Vector3().fromArray(meta.landmarks[name]);
  const center = (name: string) => new THREE.Vector3().fromArray(meta.organs[name].center);
  const vessel = walker(meta, true);
  const gut = walker(meta, false);

  const rightAtrium = lm("right_cardiac_atrium");
  const rightVentricle = lm("heart_right_ventricle");
  const leftAtrium = lm("left_cardiac_atrium");
  const leftVentricle = lm("heart_left_ventricle");
  const portaHepatis = lm("porta_hepatis");
  const liver = center("liver");
  const brain = center("brain");
  const lungL = center("lung_L");
  const lungR = center("lung_R");
  const kidneyL = center("kidney_L");
  const kidneyR = center("kidney_R");
  const bladder = center("bladder");
  const pancreas = lm("body_of_pancreas");
  const ileocecal = lm("ileocecal_valve");

  const route = (id: RouteId, points: Line, passes: number, trunk = false): Route => ({ id, points: smoothLine(points, passes), trunk, feeders: [] });
  const asVessel = (id: RouteId, points: Line, shape: { trunk?: boolean; feeders?: RouteId[] } = {}): Route => ({ ...route(id, points, SMOOTHING.vesselPasses), trunk: shape.trunk ?? false, feeders: shape.feeders ?? [] });
  const offAorta: RouteId[] = ["arch", "descending"];

  // Blood returns.
  const ivc = vessel(extreme(meta.centerlines.inferior_vena_cava_b, "lowest"), ["inferior_vena_cava_b", "inferior_vena_cava_a", rightAtrium]);
  const svc = vessel(extreme(meta.centerlines.superior_vena_cava, "highest"), ["superior_vena_cava", rightAtrium]);
  const portalVein = meta.centerlines.portal_vein ? "portal_vein" : "hepatic_portal_vein";

  // Blood going out. The aorta's skeleton has a gap across the diaphragm; the walk bridges it.
  const arch = vessel(leftVentricle, [lm("aortic_valve"), "ascending_aorta", "aortic_arch"]);
  const aorta = vessel(arch[arch.length - 1], ["descending_aorta_a", "descending_aorta_b"]);

  const renalArtery = (kidney: THREE.Vector3) => {
    const name = closestByReach(meta, ["renal_artery_L", "renal_artery_R"], kidney);
    return { name, root: rootOn(aorta, meta.centerlines[name]) };
  };
  const renalVein = (kidney: THREE.Vector3) => closestByReach(meta, ["renal_vein_L", "renal_vein_R"], kidney);
  const arteryL = renalArtery(kidneyL);
  const arteryR = renalArtery(kidneyR);
  const fromKidney = (kidney: THREE.Vector3, hilum: THREE.Vector3) => {
    const toCava = vessel(kidney, [hilum, renalVein(kidney)]);
    return [...toCava, ...ivc.slice(nearestIndex(ivc, toCava[toCava.length - 1]))];
  };
  // Down the back wall of the abdomen, over the pelvic brim, then forward into the back of the bladder.
  const ureter = (kidney: THREE.Vector3, hilum: THREE.Vector3, orifice: THREE.Vector3): Line => {
    const drop = hilum.y - orifice.y;
    const side = Math.sign(hilum.x);
    return [
      kidney,
      hilum,
      new THREE.Vector3(hilum.x * 0.78, hilum.y - drop * 0.38, hilum.z + 0.004),
      new THREE.Vector3((hilum.x + orifice.x) * 0.55, hilum.y - drop * 0.72, hilum.z - 0.002),
      new THREE.Vector3(orifice.x + side * 0.018, orifice.y + drop * 0.06, orifice.z - 0.012),
      orifice,
      bladder,
    ];
  };

  // The thoracic duct lies against the aorta all the way up, then joins the left venous angle.
  const svcTop = svc[0];
  const leftBrachiocephalic = meta.centerlines.brachiocephalic_vein_L;
  const venousAngle = leftBrachiocephalic
    ? toLine(leftBrachiocephalic).reduce((a, b) => (b.x > a.x ? b : a))
    : svcTop.clone().add(new THREE.Vector3(0.045, 0.03, 0.01));
  const ductOffset = new THREE.Vector3(-0.012, 0, -0.01);
  const duct = [...aorta].reverse().map((p) => p.clone().add(ductOffset));

  const jugular = new THREE.Vector3(svcTop.x - 0.015, (brain.y + svcTop.y) / 2, svcTop.z + 0.01);
  const carotidRoot = rootOn(arch, meta.centerlines.left_common_carotid_artery_a ?? meta.centerlines.left_common_carotid_artery_b);

  // Limb vessels come from the skeleton through setLimbs, since they follow height and posture.
  const bifurcation = aorta[aorta.length - 1];
  const stomachOut = Array.from({ length: 40 }, (_, i) => stomachPath.getPointAt(0.45 + (0.55 * i) / 39));
  const duodenum = gut(stomachOut[stomachOut.length - 1], ["duodenum_inside"]);
  const jejunum = gut(duodenum[duodenum.length - 1], ["jejunum"]);
  const ileum = gut(jejunum[jejunum.length - 1], ["ileum", ileocecal]);

  return {
    esophagus: route("esophagus", Array.from({ length: 40 }, (_, i) => esophagusPath.getPointAt(i / 39)), 0),
    stomach_out: route("stomach_out", stomachOut, 0),
    duodenum: route("duodenum", duodenum, SMOOTHING.vesselPasses),
    jejunum: route("jejunum", jejunum, SMOOTHING.bowelPasses),
    ileum: route("ileum", ileum, SMOOTHING.bowelPasses),
    // The colon's skeletons fold over themselves, so its route follows the part centres, which frame the belly cleanly.
    colon: route("colon", [ileocecal, lm("ascending_colon"), lm("hepatic_flexure_of_colon"), lm("transverse_colon"), lm("splenic_flexure_of_colon"), lm("descending_colon"), lm("sigmoid_colon"), lm("rectum")], SMOOTHING.gutPasses, true),

    portal_liver: asVessel("portal_liver", vessel(extreme(meta.centerlines.superior_mesenteric_vein, "lowest"), ["superior_mesenteric_vein", portalVein, portaHepatis, liver]), { trunk: true }),
    liver_out: asVessel("liver_out", [liver, ...ivc.slice(nearestIndex(ivc, endpointNearest(meta.centerlines.middle_hepatic_vein, rightAtrium)))]),
    ivc: asVessel("ivc", ivc, { trunk: true }),
    svc: asVessel("svc", svc, { trunk: true }),

    to_lung_L: asVessel("to_lung_L", vessel(rightAtrium, [rightVentricle, "pulmonary_trunk", "pulmonary_artery_L", lungL])),
    to_lung_R: asVessel("to_lung_R", vessel(rightAtrium, [rightVentricle, "pulmonary_trunk", "pulmonary_artery_R", lungR])),
    from_lung_L: asVessel("from_lung_L", vessel(lungL, ["pulmonary_vein_L_sup", leftAtrium, leftVentricle])),
    from_lung_R: asVessel("from_lung_R", vessel(lungR, ["pulmonary_vein_R_sup", leftAtrium, leftVentricle])),

    arch: asVessel("arch", arch, { trunk: true }),
    carotid: asVessel("carotid", vessel(carotidRoot, ["left_common_carotid_artery_a", "left_common_carotid_artery_b", brain]), { feeders: ["arch"] }),
    to_neck: asVessel("to_neck", vessel(carotidRoot, ["left_common_carotid_artery_a", lm("thyroid_cartilage")]), { feeders: ["arch"] }),
    descending: asVessel("descending", aorta, { trunk: true, feeders: ["arch"] }),
    to_gut: asVessel("to_gut", vessel(rootOn(aorta, meta.centerlines.superior_mesenteric_artery), ["superior_mesenteric_artery"]), { feeders: offAorta }),
    to_kidney_L: asVessel("to_kidney_L", vessel(arteryL.root, [arteryL.name, lm("hilum_of_kidney_L"), kidneyL]), { feeders: offAorta }),
    to_kidney_R: asVessel("to_kidney_R", vessel(arteryR.root, [arteryR.name, lm("hilum_of_kidney_R"), kidneyR]), { feeders: offAorta }),
    from_kidney_L: asVessel("from_kidney_L", fromKidney(kidneyL, lm("hilum_of_kidney_L"))),
    from_kidney_R: asVessel("from_kidney_R", fromKidney(kidneyR, lm("hilum_of_kidney_R"))),
    from_brain: asVessel("from_brain", vessel(brain, [jugular, "brachiocephalic_vein_R", svc])),
    to_liver_art: asVessel("to_liver_art", vessel(rootOn(aorta, meta.centerlines.celiac_trunk), ["celiac_trunk", "common_hepatic_artery", "proper_hepatic_artery", portaHepatis, liver]), { feeders: offAorta }),

    // Insulin leaves the pancreas into the portal vein, so the liver sees it first.
    pancreas_portal: asVessel("pancreas_portal", vessel(pancreas, [portalVein, portaHepatis, liver])),

    // Dietary fat skips the portal vein: lacteals, thoracic duct, left venous angle.
    lymph: asVessel("lymph", [...duct, venousAngle], { trunk: true }),
    lymph_svc: asVessel("lymph_svc", vessel(venousAngle, ["brachiocephalic_vein_L", svc])),

    to_bladder_L: asVessel("to_bladder_L", ureter(kidneyL, lm("hilum_of_kidney_L"), lm("ureteral_orifice_L"))),
    to_bladder_R: asVessel("to_bladder_R", ureter(kidneyR, lm("hilum_of_kidney_R"), lm("ureteral_orifice_R"))),

    leg_L: { id: "leg_L", points: [bifurcation, bifurcation], trunk: true, feeders: offAorta },
    leg_R: { id: "leg_R", points: [bifurcation, bifurcation], trunk: true, feeders: offAorta },
    arm_L: { id: "arm_L", points: [svcTop, svcTop], trunk: true, feeders: ["arch"] },
    arm_R: { id: "arm_R", points: [svcTop, svcTop], trunk: true, feeders: ["arch"] },
  };
}

// Named paths through the body over the real vessels. Process lines are drawn along these.
export class RouteNetwork {
  private readonly routes: Record<RouteId, Route>;
  // Moves whenever posture reshapes the limb routes.
  limbVersion = 0;

  constructor(meta: OrganMeta, stomachPath: THREE.Curve<THREE.Vector3>, esophagusPath: THREE.Curve<THREE.Vector3>) {
    this.routes = buildRoutes(meta, stomachPath, esophagusPath);
  }

  route(id: RouteId): Route {
    return this.routes[id];
  }

  setLimbs(limbs: { legL: Line; legR: Line; armL: Line; armR: Line }) {
    this.routes.leg_L.points = limbs.legL;
    this.routes.leg_R.points = limbs.legR;
    this.routes.arm_L.points = limbs.armL;
    this.routes.arm_R.points = limbs.armR;
    this.limbVersion++;
  }
}

export const isLimbRoute = (id: RouteId) => id === "leg_L" || id === "leg_R" || id === "arm_L" || id === "arm_R";

const SIDE = /_[LR]$/;

// Both sides of a pair named in a row mean both at once, so the line forks there and each strand takes one side.
function sidesOf(routes: RouteId[]): RouteId[][] {
  const one: RouteId[] = [];
  const other: RouteId[] = [];
  for (let i = 0; i < routes.length; i++) {
    const id = routes[i];
    const next = routes[i + 1];
    if (next && next !== id && SIDE.test(id) && id.replace(SIDE, "") === next.replace(SIDE, "")) {
      one.push(id);
      other.push(next);
      i++;
    } else {
      one.push(id);
      other.push(id);
    }
  }
  return one.length === routes.length ? [one] : [one, other];
}

// The path for one run of a process: from where the line stands, along its routes, to where it
// ends. A route that isn't reached exactly gets a short connector, and a trunk is only ridden from
// where the line joins it to where the next step leaves it.
export function tracePath(network: RouteNetwork, routes: RouteId[], from: THREE.Vector3 | null, to: THREE.Vector3 | null): Line {
  const first = routes.length ? network.route(routes[0]) : null;
  const arrivesFromAway = from !== null && first !== null && first.feeders.length > 0 && first.points[nearestIndex(first.points, from)].distanceTo(from) > FEEDER_REACH;
  const riding = arrivesFromAway && first ? [...first.feeders, ...routes] : routes;
  const out: Line = from ? [from] : [];
  let cursor = from;
  riding.forEach((id, k) => {
    const route = network.route(id);
    const points = route.points;
    let start = 0;
    let last = points.length - 1;
    if (route.trunk) {
      if (cursor) start = nearestIndex(points, cursor);
      const next = k + 1 < riding.length ? network.route(riding[k + 1]).points[0] : to;
      if (next) last = Math.max(start, nearestIndex(points, next));
    }
    for (let i = start; i <= last; i++) out.push(points[i]);
    cursor = points[last];
  });
  if (to) out.push(to);
  return smoothLine(out, SMOOTHING.pathPasses);
}

// A jump between two stops with nothing running between them: a quiet bow, so it reads as "and then"
// and nobody takes it for a vessel.
function arcBetween(from: THREE.Vector3, to: THREE.Vector3): Line {
  const middle = from.clone().lerp(to, 0.5);
  const reach = from.distanceTo(to);
  const across = to.clone().sub(from).cross(FRONT).normalize();
  if (across.x * middle.x < 0) across.negate();
  const bend = middle.addScaledVector(across, reach * ARC.bow).addScaledVector(FRONT, reach * ARC.forward);
  const curve = new THREE.QuadraticBezierCurve3(from, bend, to);
  return curve.getPoints(Math.max(ARC.leastSamples, Math.round(reach / SMOOTHING.spacing)));
}

function strandFrom(path: Line, startsAt: number): Strand {
  const lengths = arcLengths(path);
  return { path, lengths, total: lengths.length ? lengths[lengths.length - 1] : 0, startsAt };
}

// Everything drawn for one stop. The first strand ends at the stop's anchor; a second, if the routes
// fork, runs only from where it parts from the first.
export function traceStrands(network: RouteNetwork, routes: RouteId[], from: THREE.Vector3 | null, to: THREE.Vector3 | null): Strand[] {
  if (!routes.length && from && to && from.distanceTo(to) > ARC_FROM) return [strandFrom(arcBetween(from, to), 0)];
  const sides = sidesOf(routes);
  if (sides.length === 1) return [strandFrom(tracePath(network, routes, from, to), 0)];
  const firstOf = (side: RouteId[]) => network.route(side[0]).points[0];
  const lastOf = (side: RouteId[]) => {
    const points = network.route(side[side.length - 1]).points;
    return points[points.length - 1];
  };
  const nearer = (point: THREE.Vector3, ends: (side: RouteId[]) => THREE.Vector3) => (ends(sides[1]).distanceToSquared(point) < ends(sides[0]).distanceToSquared(point) ? 1 : 0);
  const reaches = to ? nearer(to, lastOf) : 0;
  const leaves = from ? nearer(from, firstOf) : 0;
  const sharedStart = sides[0][0] === sides[1][0];
  // A trunk with no stop on it would run its whole length, so the far side of a limb stops level with the near side.
  const mirrored = to ? to.clone().setX(-to.x) : null;
  const endOf = (side: RouteId[], i: number) => (i === reaches ? to : network.route(side[side.length - 1]).trunk ? mirrored : null);
  const lines = sides.map((side, i) => tracePath(network, side, sharedStart || i === leaves ? from : null, endOf(side, i)));
  const main = strandFrom(lines[reaches], 0);
  const other = lines[1 - reaches];
  let parted = 0;
  while (parted < other.length && main.path[nearestIndex(main.path, other[parted])].distanceTo(other[parted]) < SHARED_WITHIN) parted++;
  const start = Math.max(0, parted - 1);
  const rest = other.slice(start);
  if (rest.length < 2) return [main];
  return [main, strandFrom(rest, parted === 0 ? 0 : main.lengths[nearestIndex(main.path, other[start])])];
}

function arcLengths(line: Line): number[] {
  const lengths = line.length ? [0] : [];
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + line[i].distanceTo(line[i - 1]));
  return lengths;
}

export function pointAlong(line: Line, lengths: number[], at: number, out: THREE.Vector3) {
  let lo = 0;
  let hi = lengths.length - 1;
  while (hi - lo > 1) {
    const middle = (lo + hi) >> 1;
    if (lengths[middle] < at) lo = middle;
    else hi = middle;
  }
  const span = lengths[hi] - lengths[lo] || 1;
  return out.lerpVectors(line[lo], line[hi], Math.max(0, Math.min(1, (at - lengths[lo]) / span)));
}
