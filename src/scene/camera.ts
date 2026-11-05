import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// CSS pixels of the canvas taken up by panels, so the object can sit in what is left.
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Framing {
  target: THREE.Vector3;
  height: number; // metres that must fit vertically in the free area
  width: number; // metres that must fit horizontally in the free area
  azimuth: number | null; // radians around the body from straight ahead; null keeps the current angle
  polar: number | null; // radians down from straight above; null keeps the current angle
  head: { top: number; chin: number }; // heights of the head, so the picture's edge never cuts across the face
  headroom: number | null; // share of the free area's height to leave above the head, which then decides the height of the view
}

// Asked again every frame of a flight, so a figure that sits down or changes height mid-flight is still framed.
export type FramingSource = (out: Framing) => void;

const FLIGHT = {
  smoothTime: 0.17, // settles within about 600 ms
  reducedSmoothTime: 0.05,
  settled: { position: 0.0006, logDistance: 0.0012, angle: 0.0012 },
};
const INSET_RATE = 7;
const LEAST_FREE_SHARE = 0.35; // of the canvas, however large the panels are
const HEAD_CLEARANCE = 0.012; // metres the edge of the picture stays clear of a head it shows whole

// A critically damped spring: starts and stops gently, and a new goal mid-flight doesn't kick.
class Damped {
  value = 0;
  velocity = 0;

  reset(value: number) {
    this.value = value;
    this.velocity = 0;
  }

  step(goal: number, dt: number, smoothTime: number) {
    const omega = 2 / smoothTime;
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - goal;
    const carry = (this.velocity + omega * change) * dt;
    this.velocity = (this.velocity - omega * carry) * decay;
    this.value = goal + (change + carry) * decay;
  }
}

function shortestArc(from: number, to: number) {
  const turn = Math.PI * 2;
  return from + ((((to - from + Math.PI) % turn) + turn) % turn) - Math.PI;
}

export class CameraRig {
  private source: FramingSource | null = null;
  private inFlight = false;
  private viewerMoved = false;
  private readonly framing: Framing = { target: new THREE.Vector3(), height: 1, width: 1, azimuth: null, polar: null, head: { top: 0, chin: 0 }, headroom: null };
  private readonly x = new Damped();
  private readonly y = new Damped();
  private readonly z = new Damped();
  private readonly logDistance = new Damped();
  private readonly azimuth = new Damped();
  private readonly polar = new Damped();
  private readonly spherical = new THREE.Spherical();
  private readonly offset = new THREE.Vector3();
  private readonly insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private insetGoal: Insets = this.insets;
  private width = 1;
  private height = 1;
  private shownOffsetX = NaN;
  private shownOffsetY = NaN;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: Pick<OrbitControls, "target" | "minDistance" | "maxDistance">,
  ) {}

  get flying() {
    return this.inFlight;
  }

  setViewport(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.shownOffsetX = NaN;
    this.applyViewOffset();
    if (this.source && !this.viewerMoved) this.fly(this.source);
  }

  // A viewer's drag ends the flight, and the view stays where they put it until something new is asked for.
  cancel() {
    this.inFlight = false;
    this.viewerMoved = true;
  }

  // The figure moved under the camera, say by sitting down: carry the view along with it.
  translateY(dy: number) {
    this.controls.target.y += dy;
    this.camera.position.y += dy;
    this.y.value += dy;
  }

  snap(source: FramingSource, insets: Insets) {
    this.source = source;
    this.viewerMoved = false;
    this.inFlight = false;
    this.insetGoal = insets;
    Object.assign(this.insets, insets);
    this.applyViewOffset();
    this.readPose();
    source(this.framing);
    const distance = this.distanceFor(this.framing);
    this.x.reset(this.framing.target.x);
    this.y.reset(this.aimedY(this.framing, distance));
    this.z.reset(this.framing.target.z);
    this.logDistance.reset(Math.log(distance));
    if (this.framing.azimuth !== null) this.azimuth.reset(this.framing.azimuth);
    if (this.framing.polar !== null) this.polar.reset(this.framing.polar);
    this.writePose();
  }

  fly(source: FramingSource) {
    this.source = source;
    this.viewerMoved = false;
    if (!this.inFlight) this.readPose();
    this.inFlight = true;
  }

  update(dt: number, insets: Insets, motion: boolean) {
    this.followInsets(insets);
    const k = 1 - Math.exp(-dt * INSET_RATE);
    this.insets.left += (insets.left - this.insets.left) * k;
    this.insets.right += (insets.right - this.insets.right) * k;
    this.insets.top += (insets.top - this.insets.top) * k;
    this.insets.bottom += (insets.bottom - this.insets.bottom) * k;
    this.applyViewOffset();
    if (!this.inFlight || !this.source) return;

    this.source(this.framing);
    const smoothTime = motion ? FLIGHT.smoothTime : FLIGHT.reducedSmoothTime;
    const goal = this.framing;
    const goalDistance = this.distanceFor(goal);
    const goalLogDistance = Math.log(goalDistance);
    const goalY = this.aimedY(goal, goalDistance);
    const goalAzimuth = goal.azimuth === null ? this.azimuth.value : shortestArc(this.azimuth.value, goal.azimuth);
    const goalPolar = goal.polar ?? this.polar.value;
    this.x.step(goal.target.x, dt, smoothTime);
    this.y.step(goalY, dt, smoothTime);
    this.z.step(goal.target.z, dt, smoothTime);
    this.logDistance.step(goalLogDistance, dt, smoothTime);
    this.azimuth.step(goalAzimuth, dt, smoothTime);
    this.polar.step(goalPolar, dt, smoothTime);
    this.writePose();

    const { position, logDistance, angle } = FLIGHT.settled;
    const settled =
      Math.abs(this.x.value - goal.target.x) < position &&
      Math.abs(this.y.value - goalY) < position &&
      Math.abs(this.z.value - goal.target.z) < position &&
      Math.abs(this.logDistance.value - goalLogDistance) < logDistance &&
      Math.abs(this.azimuth.value - goalAzimuth) < angle &&
      Math.abs(this.polar.value - goalPolar) < angle;
    if (settled) this.inFlight = false;
  }

  // A panel opening or closing changes what room is left, so the framing is worked out again,
  // unless the viewer has since put the camera somewhere themselves.
  private followInsets(insets: Insets) {
    const goal = this.insetGoal;
    if (goal.left === insets.left && goal.right === insets.right && goal.top === insets.top && goal.bottom === insets.bottom) return;
    this.insetGoal = insets;
    if (this.source && !this.viewerMoved) this.fly(this.source);
  }

  private distanceFor(framing: Framing) {
    const slope = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const freeHeight = Math.max(this.height - this.insetGoal.top - this.insetGoal.bottom, this.height * LEAST_FREE_SHARE);
    const freeWidth = Math.max(this.width - this.insetGoal.left - this.insetGoal.right, this.width * LEAST_FREE_SHARE);
    const byHeight = ((framing.height / slope) * this.height) / freeHeight;
    const byWidth = (((framing.width / slope) / this.camera.aspect) * this.width) / freeWidth;
    return THREE.MathUtils.clamp(Math.max(byHeight, byWidth), this.controls.minDistance, this.controls.maxDistance);
  }

  // Where to aim so the top edge of the picture never crosses the face: the whole head is in, or the
  // crop is below the chin. A framing can also fix how much room stays above the head.
  private aimedY(framing: Framing, distance: number) {
    const slope = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const metresPerPixel = (slope * distance) / this.height;
    const freeHeight = Math.max(this.height - this.insetGoal.top - this.insetGoal.bottom, this.height * LEAST_FREE_SHARE);
    const toTopEdge = (this.insetGoal.top + freeHeight / 2) * metresPerPixel;
    const { top, chin } = framing.head;
    if (framing.headroom !== null) return top + (framing.headroom - 0.5) * freeHeight * metresPerPixel;
    const edge = framing.target.y + toTopEdge;
    if (edge <= chin || edge >= top + HEAD_CLEARANCE) return framing.target.y;
    return framing.target.y + (framing.target.y < chin ? chin - edge : top + HEAD_CLEARANCE - edge);
  }

  private readPose() {
    const target = this.controls.target;
    this.x.reset(target.x);
    this.y.reset(target.y);
    this.z.reset(target.z);
    this.spherical.setFromVector3(this.offset.copy(this.camera.position).sub(target));
    this.logDistance.reset(Math.log(this.spherical.radius));
    this.azimuth.reset(this.spherical.theta);
    this.polar.reset(this.spherical.phi);
  }

  private writePose() {
    this.controls.target.set(this.x.value, this.y.value, this.z.value);
    this.spherical.set(Math.exp(this.logDistance.value), this.polar.value, this.azimuth.value);
    this.camera.position.setFromSpherical(this.spherical).add(this.controls.target);
  }

  // Shifts the picture itself, so the point the view orbits around sits in the middle of the free
  // area, and projecting and picking stay correct without knowing about panels.
  private applyViewOffset() {
    const offsetX = (this.insets.right - this.insets.left) / 2;
    const offsetY = (this.insets.bottom - this.insets.top) / 2;
    if (Math.abs(offsetX - this.shownOffsetX) < 0.1 && Math.abs(offsetY - this.shownOffsetY) < 0.1) return;
    this.shownOffsetX = offsetX;
    this.shownOffsetY = offsetY;
    this.camera.setViewOffset(this.width, this.height, offsetX, offsetY, this.width, this.height);
  }
}
