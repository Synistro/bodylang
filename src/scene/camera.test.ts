import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CameraRig, Framing, Insets } from "./camera";

const WIDTH = 1310;
const HEIGHT = 900;
const INSETS: Insets = { left: 290, right: 290, top: 30, bottom: 80 };
const FRAME = 1 / 60;

function rigAt(position: THREE.Vector3) {
  const camera = new THREE.PerspectiveCamera(21, 1, 0.1, 30);
  camera.position.copy(position);
  const controls = { target: new THREE.Vector3(0, 1, 0), minDistance: 0.45, maxDistance: 14 };
  const rig = new CameraRig(camera, controls);
  rig.setViewport(WIDTH, HEIGHT);
  const step = (seconds: number) => {
    for (let t = 0; t < seconds; t += FRAME) {
      rig.update(FRAME, INSETS, true);
      camera.lookAt(controls.target);
      camera.updateMatrixWorld(true);
    }
  };
  return { camera, controls, rig, step };
}

const toPixels = (world: THREE.Vector3, camera: THREE.Camera) => {
  const p = world.clone().project(camera);
  return { x: ((p.x + 1) / 2) * WIDTH, y: ((1 - p.y) / 2) * HEIGHT };
};

const goal = (out: Framing) => {
  out.target.set(0.02, 1.3, 0.14);
  out.height = 0.45;
  out.width = 0.45;
  out.azimuth = 2.5;
  out.polar = 1.45;
};

describe("camera flight", () => {
  it("settles on the framing within about 600 ms, the short way round", () => {
    const { rig, step, controls, camera } = rigAt(new THREE.Vector3(1, 1.3, 3));
    rig.snap((out) => {
      out.target.set(0, 1, 0.06);
      out.height = 1.8;
      out.width = 1.1;
      out.azimuth = -2.5;
      out.polar = 1.5;
    }, INSETS);
    rig.fly(goal);
    step(0.6);
    expect(controls.target.distanceTo(new THREE.Vector3(0.02, 1.3, 0.14))).toBeLessThan(0.01);
    step(0.3);
    expect(rig.flying).toBe(false);
    const offset = camera.position.clone().sub(controls.target);
    expect(new THREE.Spherical().setFromVector3(offset).theta).toBeCloseTo(2.5, 1);
  });

  it("centres the view in the free area and fits the framing inside it", () => {
    const { rig, step, controls, camera } = rigAt(new THREE.Vector3(1, 1.3, 3));
    rig.snap(goal, INSETS);
    step(0.1);
    const center = toPixels(controls.target, camera);
    expect(center.x).toBeCloseTo(655, 0);
    expect(center.y).toBeCloseTo(425, 0);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(0.45 / 2);
    const edge = toPixels(controls.target.clone().add(right), camera);
    expect(edge.x).toBeLessThanOrEqual(WIDTH - INSETS.right + 1);
    expect(edge.x).toBeGreaterThan(WIDTH - INSETS.right - 80);
  });

  it("measures the room above the head from the top of the free area", () => {
    for (const top of [20, 96, 240]) {
      const insets: Insets = { left: 0, right: 0, top, bottom: 300 };
      const camera = new THREE.PerspectiveCamera(21, WIDTH / HEIGHT, 0.1, 30);
      camera.position.set(0, 1, 4);
      const controls = { target: new THREE.Vector3(0, 1, 0), minDistance: 0.45, maxDistance: 14 };
      const rig = new CameraRig(camera, controls);
      rig.setViewport(WIDTH, HEIGHT);
      rig.snap((out) => {
        out.target.set(0, 1, 0);
        out.height = 1.6;
        out.width = 0.6;
        out.azimuth = 0;
        out.polar = Math.PI / 2;
        out.headroom = 0.05;
        out.head.top = 1.8;
        out.head.chin = 1.55;
      }, insets);
      rig.update(FRAME, insets, true);
      camera.lookAt(controls.target);
      camera.updateMatrixWorld(true);
      const free = HEIGHT - top - 300;
      expect(toPixels(new THREE.Vector3(0, 1.8, 0), camera).y).toBeCloseTo(top + 0.05 * free, 0);
    }
  });

  it("leaves the view alone once the viewer has dragged", () => {
    const { rig, step, controls } = rigAt(new THREE.Vector3(1, 1.3, 3));
    rig.snap(goal, INSETS);
    rig.fly((out) => {
      goal(out);
      out.target.set(0, 0.5, 0);
    });
    step(0.1);
    rig.cancel();
    const at = controls.target.clone();
    step(0.5);
    expect(controls.target.distanceTo(at)).toBe(0);
    rig.setViewport(WIDTH, HEIGHT);
    step(0.5);
    expect(controls.target.distanceTo(at)).toBe(0);
  });
});
