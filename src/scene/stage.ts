import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { curveStrength, EventTrack, illnessSites, MuscleState, muscleStateAt, ResolvedEvent, TrackFrom } from "../model/events";
import { MUSCLE_GROUPS, MUSCLE_LABEL, MuscleGroup } from "../model/muscleGroups";
import { LIVER, MUSCLE_RECOVERY, REFERENCE, STOMACH } from "../model/params";
import type { Process, ProcessStop } from "../model/processes/line";
import { Body, POSTURES, Posture, Sex } from "../model/scenario";
import { ledgerAt, Trajectory, value } from "../model/engine/trajectory";
import { OrganId, SystemId } from "../model/ids";
import { organStates } from "./organStates";
import { ORGAN_NAME, SYSTEMS, systemById } from "../model/systems";
import { ACCENT_SYSTEM, organHue, viewSystemOf } from "../look";
import { WALL, WALL_FPS, WALL_PIXEL_RATIO } from "../wall";
import { OrganAsset, loadBody, loadOrgans } from "./assets";
import { CameraRig, FramingSource, Insets } from "./camera";
import { Figure } from "./figure";
import { RouteNetwork } from "./routes";
import { LYMPH_CLUSTERS, LymphCluster, LymphNodes } from "./lymph";
import { PALETTES, Palette, setContourWeight, setMaterialClock } from "./materials";
import { BodySide, MuscleLevel, Muscles, loadMuscles } from "./muscles";
import { Anatomy, OrganPart, PartLook, PartName, PartStyle } from "./anatomy";
import { ProcessLine } from "./processLine";
import { StomachItem, Stomach } from "./stomach";
import type { Theme } from "../look";


export interface SceneInput {
  trajectory: Trajectory;
  t: number;
  muscleMinute: number; // what the muscles show, which a walkthrough step can take off the day chart
  track?: EventTrack | null; // an injury's line through the body: what it crosses stands out, and the view turns to show it
  body: Body;
  theme: Theme;
  layers: { skin: boolean; vessels: boolean };
  system: SystemId;
  process: Process | null;
  stop: number | null;
  focus: OrganId | null;
  focusMuscle: MuscleGroup | null;
  hoverMuscle: MuscleGroup | null;
  hover: OrganId | null;
  insets: Insets; // screen taken by panels, in CSS px; the object frames itself in what is left
}

// Anything on the body the interface can put a label on.
export type AnchorId = OrganId | `muscle:${MuscleGroup}` | "thymus" | "airway" | `lymph:${LymphCluster}`;

// What a point on the screen lands on. `onBody` also covers a muscle nobody has a name for.
export interface PickTarget {
  organ: OrganId | null;
  muscle: MuscleGroup | null;
  onBody: boolean;
}

interface Ramp {
  low: THREE.Color;
  high: THREE.Color;
  calm: THREE.Color; // a muscle repairing, or sore
}
const RAMP = { lowShare: 0.16, calmShare: 0.5 };
const newRamp = (): Ramp => ({ low: new THREE.Color(), high: new THREE.Color(), calm: new THREE.Color() });

const LENS_FOV = 21;
const KCAL_PER_CHUNK = 11;
const FOOD_COLOR = { sugar: "#d9a07f", starch: "#dfae8f", fat: "#e4bb9c", protein: "#cd9272" };
const EASE_RATE = 7; // per second; a change is settled within about 600 ms
const CONTOUR_CSS_PX = 0.9;
const IDLE_SWAY = { rate: 0.32, radiansPerSecond: 0.02 }; // swings about ±3.5° around where the view started

const REM_AT_UNIT_SCALE = 10;

const FIGURE_AZIMUTH = 0.2;
const PROFILE = Math.PI / 2;
// A line seen end on is a dot, so the view turns side-on to a track.
const TRACK_AZIMUTH: Record<TrackFrom, number> = { front: 1.05, back: 1.05, left: 0.15, right: 0.15, above: 0.5, below: 0.5 };
const HEAD_CENTRE_BELOW_BRAIN = 0.028; // of figure height, so the Brain view centres the whole head
const HEADROOM = 0.04; // of the free area's height, to the head's rest position; about 40 px from the canvas top at 1440x900
const LEVEL_POLAR = 1.5;

const WORK = { most: 0.8, curve: 1.8, subjectLeast: 0.05 };
const FOOD_CALM = 0.82; // how far pieces of food lean into the warm ramp when you aren't looking at them
const LOOK = {
  restFill: 0.09,
  contextFill: 0.012,
  focusContextOpacity: 0.75, // of a part's usual context opacity: while one organ is close, the rest recede further
  focusGhost: 0.3, // an organ in close-up is at its most solid, however open it stays as part of a system
  continuingFill: 0.42, // the part that carries on from an organ in close-up, so what leaves that organ visibly goes somewhere
  stopOutline: { opacity: 0.95, fill: 0.05 }, // a stop on a process that isn't the current one
  litStopTint: 0.72, // the one that is
  stomachFocusGhost: 0.88, // the stomach stays open in close-up so what's inside it shows
  stomachOnStop: 0.3, // what is inside it, while it is a stop but not the current one
  esophagus: { subject: 0.8, context: 0.28 },
};
// Looking straight at belly fat is the one thing that washes the skin: it has no shape of its own.
const BELLY_WASH = { focus: 0.16, hover: 0.08, pickableAbove: 0.02, radius: 0.09 };

const MUSCLE_LOOK = {
  faint: 0.24, // a worked group inside the contour, away from the Muscles system
  outline: 0.55, // a worked group on a process, as lines only
  stopFlush: 0.7, // the group the process is at
  stopShown: 0.8,
  flush: { least: 0.2, most: 0.84 },
  repairWeight: 0.8, // how much each after-effect counts toward the calm flush
  fatigueWeight: 0.6,
  focusLeast: 0.14, // a group in close-up that has done nothing still lifts from the rest
  uptake: { least: 0.16, gain: 0.26, flush: 0.8 }, // the big sugar takers, for the views about fuel
  azimuthStep: 0.3, // radians; the turn toward what was worked only changes in whole steps
};
const UPTAKE_GROUPS: MuscleGroup[] = ["quads", "hamstrings", "glutes", "biceps", "triceps"];

const MOOD = { stress: 0.9, reward: 0.7 };
const FEVER = { fromC: 37.4, fullC: 39.4, contourWarmth: 0.5 };
const COUGH = { tint: 0.6, ghost: 0.55, leastOpacity: 0.8, pulse: 0.5 };

const SHELL_BACK_SHARE = 0.4;

const STOP_FRAMING = { height: 0.2, width: 0.2 };
const LINE_FRAMING = { heightMargin: 1.24, widthMargin: 1.36, least: 0.34, overHead: 0.03 }; // a line reaching the head shows all of it

type VesselMood = "hidden" | "rest" | "faded" | "subject";

const VESSEL_MOODS: Record<VesselMood, { artery: number; vein: number; body: number; wave: number; coloured: boolean }> = {
  hidden: { artery: 0, vein: 0, body: 0, wave: 0, coloured: false },
  rest: { artery: 0.2, vein: 0.12, body: 0, wave: 0, coloured: false },
  faded: { artery: 0.05, vein: 0.03, body: 0, wave: 0, coloured: false },
  subject: { artery: 0.92, vein: 0.62, body: 1, wave: 1, coloured: true },
};

// Named places a framing can aim at. They stay correct as the body changes height or sits down.
interface Places {
  height: number;
  organ(id: OrganId, out: THREE.Vector3): THREE.Vector3;
  joint(name: string, out: THREE.Vector3): THREE.Vector3;
  standing(share: number, out: THREE.Vector3): THREE.Vector3; // on the midline at a share of standing height
}

interface ViewAngle {
  height: number; // shares of figure height that must fit in the free area
  standingHeight?: number; // the same for a figure on its feet, when that needs more room than seated
  width: number;
  azimuth: number;
  polar: number;
  headroom?: number; // share of the free area's height above the head; the head then sets where the view sits
}

// How the real muscles appear in a view: the whole figure, only what has been worked, also the big
// sugar takers in the limbs, or not at all.
type MuscleMood = "figure" | "worked" | "uptake" | "none";

// How one system appears. A new system is one new row here plus its entry in SYSTEMS.
interface SystemView extends ViewAngle {
  center: (places: Places, out: THREE.Vector3) => THREE.Vector3;
  atRest: boolean; // every organ keeps its resting look instead of the system's organs standing out
  turnsToWork: boolean; // the view turns toward whatever muscles were worked
  parts: readonly PartName[]; // parts with no organ of their own that stand out here too
  hides: boolean; // everything else goes, instead of receding to outlines
  vessels: VesselMood;
  muscles: MuscleMood;
  glycogen: number; // how much of the view the liver's fill level takes
  lymph: number; // how strongly the schematic lymph nodes show
}

const scratch = new THREE.Vector3();

function betweenOrgans(places: Places, a: OrganId, b: OrganId, t: number, out: THREE.Vector3) {
  return places.organ(a, out).lerp(places.organ(b, scratch), t);
}

const chestToHips = (places: Places, out: THREE.Vector3) => {
  places.joint("hips", scratch);
  return places.organ("heart", out).lerp(scratch, 0.35);
};

const row = (view: Omit<SystemView, "atRest" | "turnsToWork" | "parts" | "hides" | "vessels" | "muscles" | "glycogen" | "lymph"> & Partial<SystemView>): SystemView => ({
  atRest: false,
  turnsToWork: false,
  parts: [],
  hides: false,
  vessels: "faded",
  muscles: "none",
  glycogen: 0,
  lymph: 0,
  ...view,
});

const SYSTEM_VIEWS: Record<SystemId, SystemView> = {
  overview: row({
    center: (places, out) => places.standing(0.5, out),
    height: 0.905,
    standingHeight: 1.02,
    width: 0.56,
    azimuth: FIGURE_AZIMUTH,
    polar: LEVEL_POLAR,
    headroom: HEADROOM,
    atRest: true,
    vessels: "rest",
    muscles: "worked",
  }),
  digestion: row({
    center: (places, out) => betweenOrgans(places, "large_intestine", "stomach", 0.2, out),
    height: 0.38,
    width: 0.36,
    azimuth: 0.2,
    polar: LEVEL_POLAR,
  }),
  energy: row({
    center: (places, out) => {
      places.joint("hips", out);
      out.y += places.height * 0.1;
      out.z += places.height * 0.03;
      return out;
    },
    height: 0.72,
    width: 0.5,
    azimuth: FIGURE_AZIMUTH,
    polar: LEVEL_POLAR,
    headroom: HEADROOM,
    muscles: "uptake",
    glycogen: 0.45,
  }),
  circulation: row({
    center: chestToHips,
    height: 0.5,
    width: 0.4,
    azimuth: 0.14,
    polar: LEVEL_POLAR,
    vessels: "subject",
  }),
  muscles: row({
    center: (places, out) => places.standing(0.5, out),
    height: 0.905,
    standingHeight: 1.02,
    width: 0.6,
    azimuth: FIGURE_AZIMUTH,
    polar: LEVEL_POLAR,
    headroom: HEADROOM,
    turnsToWork: true,
    hides: true,
    vessels: "hidden",
    muscles: "figure",
  }),
  brain: row({
    center: (places, out) => {
      places.organ("brain", out);
      out.y -= places.height * HEAD_CENTRE_BELOW_BRAIN;
      return out;
    },
    height: 0.25,
    width: 0.25,
    azimuth: PROFILE,
    polar: PROFILE,
  }),
  immune: row({
    center: chestToHips,
    height: 0.62,
    width: 0.44,
    azimuth: 0.16,
    polar: LEVEL_POLAR,
    headroom: HEADROOM,
    parts: ["thymus"],
    lymph: 1,
  }),
  clearing: row({
    center: (places, out) => betweenOrgans(places, "kidneys", "bladder", 0.42, out),
    height: 0.4,
    width: 0.32,
    azimuth: 2.58, // from a little behind, so the kidneys come before the liver
    polar: LEVEL_POLAR,
  }),
  reproductive: row({
    center: (places, out) => places.organ("bladder", out),
    height: 0.14,
    width: 0.2,
    azimuth: 0.2,
    polar: LEVEL_POLAR,
  }),
};

interface FocusView extends ViewAngle {
  hides: boolean;
  vessels: VesselMood;
  glycogen: number;
  lymph: number;
}

const focusOn = (angle: ViewAngle, vessels: VesselMood = "faded", more: Partial<FocusView> = {}): FocusView => ({ ...angle, hides: false, vessels, glycogen: 0, lymph: 0, ...more });

const FOCUS_VIEWS: Record<OrganId, FocusView> = {
  brain: focusOn({ height: 0.17, width: 0.16, azimuth: PROFILE, polar: PROFILE }),
  heart: focusOn({ height: 0.12, width: 0.13, azimuth: 0.3, polar: 1.46 }, "rest"),
  lungs: focusOn({ height: 0.24, width: 0.28, azimuth: 0.14, polar: LEVEL_POLAR }),
  liver: focusOn({ height: 0.15, width: 0.17, azimuth: -0.42, polar: 1.44 }, "faded", { glycogen: 1 }),
  stomach: focusOn({ height: 0.15, width: 0.15, azimuth: 0.46, polar: LEVEL_POLAR }),
  pancreas: focusOn({ height: 0.11, width: 0.15, azimuth: 0.08, polar: LEVEL_POLAR }),
  spleen: focusOn({ height: 0.1, width: 0.11, azimuth: 1.2, polar: LEVEL_POLAR }, "faded", { lymph: 0.5 }),
  small_intestine: focusOn({ height: 0.2, width: 0.2, azimuth: 0.12, polar: LEVEL_POLAR }),
  large_intestine: focusOn({ height: 0.26, width: 0.26, azimuth: 0.12, polar: LEVEL_POLAR }),
  kidneys: focusOn({ height: 0.16, width: 0.2, azimuth: 2.72, polar: LEVEL_POLAR }),
  bladder: focusOn({ height: 0.09, width: 0.1, azimuth: 0.22, polar: LEVEL_POLAR }),
  muscle: focusOn({ height: 0.905, standingHeight: 1.02, width: 0.6, azimuth: FIGURE_AZIMUTH, polar: LEVEL_POLAR, headroom: HEADROOM }, "hidden", { hides: true }),
  fat: focusOn({ height: 0.38, width: 0.36, azimuth: FIGURE_AZIMUTH, polar: LEVEL_POLAR }),
  uterus: focusOn({ height: 0.09, width: 0.11, azimuth: 0.24, polar: LEVEL_POLAR }),
  ovaries: focusOn({ height: 0.1, width: 0.14, azimuth: 0.12, polar: LEVEL_POLAR }),
  prostate: focusOn({ height: 0.08, width: 0.09, azimuth: 0.5, polar: LEVEL_POLAR }),
};

// How to look at one muscle group. A group on both sides of the body frames both.
const MUSCLE_VIEWS: Record<MuscleGroup, ViewAngle & { both: boolean }> = {
  chest: { height: 0.3, width: 0.32, azimuth: 0.26, polar: 1.46, both: true },
  back: { height: 0.44, width: 0.36, azimuth: Math.PI - 0.22, polar: LEVEL_POLAR, both: true },
  shoulders: { height: 0.24, width: 0.24, azimuth: 0.72, polar: 1.42, both: false },
  biceps: { height: 0.26, width: 0.24, azimuth: 0.62, polar: LEVEL_POLAR, both: false },
  triceps: { height: 0.26, width: 0.24, azimuth: 2.3, polar: LEVEL_POLAR, both: false },
  forearms: { height: 0.26, width: 0.24, azimuth: 0.62, polar: LEVEL_POLAR, both: false },
  abs: { height: 0.3, width: 0.28, azimuth: 0.22, polar: LEVEL_POLAR, both: true },
  glutes: { height: 0.3, width: 0.3, azimuth: Math.PI - 0.3, polar: LEVEL_POLAR, both: true },
  quads: { height: 0.38, width: 0.36, azimuth: 0.26, polar: LEVEL_POLAR, both: true },
  hamstrings: { height: 0.38, width: 0.36, azimuth: Math.PI - 0.26, polar: LEVEL_POLAR, both: true },
  calves: { height: 0.34, width: 0.34, azimuth: Math.PI - 0.26, polar: LEVEL_POLAR, both: true },
};

// What is being shown right now, most specific first: one organ, one process, or a system.
type View =
  | { kind: "focus"; organ: OrganId; view: FocusView }
  | { kind: "process"; process: Process; stops: ReadonlyMap<OrganId, ProcessStop>; lit: ProcessStop | null }
  | { kind: "system"; view: SystemView; organs: ReadonlySet<OrganId> };

// A click passes through parts drawn as contour on its way to a part drawn solid.
const CONTOUR_AT_REST: ReadonlySet<OrganId> = new Set<OrganId>(["lungs", "small_intestine", "large_intestine"]);

const STOMACH_STYLE: PartStyle = { organ: "stomach", worksWith: null, ghost: 1, restOpacity: 1, subjectGhost: 0.6, subjectLift: 0, soft: 0, hatch: 0, normalPasses: 0, tinted: true, continues: null, staysOpen: false, subjectFill: 0.09, contextOpacity: 0.4, bareOpacity: 0 };

const ORGANS: readonly OrganId[] = ["brain", "heart", "lungs", "liver", "stomach", "pancreas", "spleen", "small_intestine", "large_intestine", "kidneys", "bladder", "uterus", "ovaries", "prostate", "muscle", "fat"];

const LYMPH_NAME: Record<LymphCluster, string> = { neck: "Neck nodes", armpit: "Armpit nodes", abdomen: "Belly nodes", groin: "Groin nodes" };

// How many lit things a view names at most.

interface SexSet {
  anatomy: Anatomy;
  stomach: Stomach;
  network: RouteNetwork;
  line: ProcessLine;
  torso: THREE.Group;
}

const easeTo = (uniform: { value: number }, target: number, k: number) => {
  uniform.value += (target - uniform.value) * k;
};

function litMuscleOf(process: Process, spotlight: number | null): MuscleGroup | null {
  const lit = spotlight === null ? process.stops.find((s) => s.state === "here") : process.stops.find((s) => s.number === spotlight);
  return lit?.muscle ?? null;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly frameListeners = new Set<(stage: Stage, dt: number) => void>();
  private readonly rig: CameraRig;
  private figure!: Figure;
  private muscles!: Muscles;
  private lymph!: LymphNodes;
  private sets!: Record<Sex, SexSet>;
  private resolution = new THREE.Vector2(1, 1);
  private hipsWorld = new THREE.Vector3();
  private framedHipsY: number | null = null;
  private limbsDirty = true;
  private sexMix = 0;
  private lastBodyKey = "";
  private sit = 0;
  private walk = 0;
  private walkPhase = 0;
  private beat = 0;
  private breath = 0;
  private lastT = performance.now();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private idleClock = 0;
  private idle = true;
  private input: SceneInput | null = null;
  private framingKey: string | null = null;
  private appliedTheme: Theme | null = null;
  private clock = 0;
  private shellFront = 1;
  private feverShown = 0;
  private bellyShown = 0;
  private chunksShown = 1;
  private foodCalm = FOOD_CALM;
  private view: { sex: Sex; sites: string; input: Pick<SceneInput, "focus" | "process" | "stop" | "system" | "theme">; view: View } | null = null;
  private work: { trajectory: Trajectory; minute: number; activity: Map<OrganId, number>; cough: number } | null = null;
  private muscleLook: { view: View; trajectory: Trajectory; minute: number; focus: MuscleGroup | null; visible: number; shown: Partial<Record<MuscleGroup, number>>; outlined: MuscleGroup[]; levels: Partial<Record<MuscleGroup, MuscleLevel>> } | null = null;
  private food: { trajectory: Trajectory; minute: number; pieces: { color: THREE.Color; count: number }[] } | null = null;
  private stomachItemPool: StomachItem[] = [];
  private raf = 0;
  private disposed = false;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly look: PartLook = { ghost: 0, tint: new THREE.Color(), tintAmount: 0, opacity: 1, highlight: 0, fill: 0, lift: 0, hatch: 0 };
  private readonly swayAxis = new THREE.Vector3(0, 1, 0);
  private readonly swayOffset = new THREE.Vector3();
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly routeEnd = new THREE.Vector3();
  private readonly boundsWorld = new THREE.Box3();
  private readonly contourColor = new THREE.Color();
  private readonly colors = {
    ink: new THREE.Color(),
    workLow: new THREE.Color(),
    workHigh: new THREE.Color(),
    contour: new THREE.Color(),
    artery: new THREE.Color(),
    vein: new THREE.Color(),
    store: new THREE.Color(),
  };
  // Every system's organs flush in its own colour, from barely tinted to full.
  private readonly ramps: Record<SystemId, Ramp> = { overview: newRamp(), digestion: newRamp(), energy: newRamp(), circulation: newRamp(), muscles: newRamp(), brain: newRamp(), immune: newRamp(), clearing: newRamp(), reproductive: newRamp() };
  private readonly places: Places = {
    height: 1.8,
    organ: (id, out) => this.organCenter(this.currentSet(), id, out),
    joint: (name, out) => this.figure.worldJoint(name, out),
    standing: (share, out) => {
      const rest = this.figure.restJoints.get("hips");
      const lowered = rest ? rest.y - this.hipsWorld.y : 0;
      return out.set(0, this.figure.height * share - lowered, 0.06);
    },
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const pixelRatio = Math.min(window.devicePixelRatio, WALL ? WALL_PIXEL_RATIO : 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(LENS_FOV, 1, 0.1, 30);
    this.camera.position.set(1.15, 1.32, 3.25);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.45;
    this.controls.maxDistance = 14;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = Math.PI - 0.25;
    this.rig = new CameraRig(this.camera, this.controls);
    this.controls.addEventListener("start", () => {
      this.idle = false;
      this.rig.cancel();
    });
  }

  async load() {
    const [bodyAsset, male, female, muscleAsset] = await Promise.all([loadBody(), loadOrgans("male"), loadOrgans("female"), loadMuscles()]);
    if (this.disposed) return;
    const palette = PALETTES.light;
    this.figure = new Figure(bodyAsset, palette);
    this.scene.add(this.figure.group);
    this.muscles = new Muscles(muscleAsset, this.figure, palette, this.resolution);
    this.scene.add(this.muscles.group);
    this.lymph = new LymphNodes(this.figure, this.renderer.getPixelRatio());
    this.scene.add(this.lymph.points);
    const build = (asset: OrganAsset): SexSet => {
      const anatomy = new Anatomy(asset, palette, this.resolution);
      const stomach = new Stomach(asset.meta, palette, this.resolution);
      const network = new RouteNetwork(asset.meta, stomach.stomachPath, stomach.esophagusPath);
      const torso = new THREE.Group();
      const set: SexSet = {
        anatomy,
        stomach,
        network,
        torso,
        line: new ProcessLine(network, (stop, process, out) => torso.worldToLocal(this.locateStop(set, stop, process, out)), this.resolution, this.renderer.getPixelRatio()),
      };
      torso.add(anatomy.group, stomach.group, set.line.group);
      this.figure.hips.add(torso);
      return set;
    };
    this.sets = { male: build(male), female: build(female) };
    this.resize();
    window.addEventListener("resize", this.resize);
    this.loop();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private resize = () => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.renderer.setSize(w, h, false);
    this.resolution.set(w, h);
    this.rig.setViewport(w, h);
    // Everything drawn in pixels follows the interface's unit, so it keeps its weight on a large display.
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const unit = rem / REM_AT_UNIT_SCALE;
    setContourWeight(CONTOUR_CSS_PX * Math.sqrt(unit), this.renderer.getPixelRatio());
    for (const set of Object.values(this.sets)) set.line.setSizeScale(unit);
    this.lymph.setSizeScale(unit);
  };

  setInput(input: SceneInput) {
    this.input = input;
  }

  stopIdle() {
    this.idle = false;
  }

  private currentSet(): SexSet {
    return this.sets[this.input?.body.sex ?? "male"];
  }

  private applyTheme(theme: Theme) {
    if (this.appliedTheme === theme) return;
    this.appliedTheme = theme;
    const palette: Palette = PALETTES[theme];
    const c = this.colors;
    c.ink.set(palette.ink);
    c.workLow.set(palette.workLow);
    c.workHigh.set(palette.workHigh);
    c.contour.set(palette.contour);
    c.artery.set(palette.artery);
    c.vein.set(palette.vein);
    c.store.set(palette.store);
    for (const { id } of SYSTEMS) {
      const ramp = this.ramps[id];
      ramp.high.set(organHue(id, theme));
      ramp.low.set(palette.tone1).lerp(ramp.high, RAMP.lowShare);
      ramp.calm.set(palette.tone3).lerp(ramp.high, RAMP.calmShare);
    }
    this.lymph.setPalette(palette, this.ramps.immune.high);
    this.muscleLook = null;
    for (const set of Object.values(this.sets)) {
      set.anatomy.setPalette(palette);
      set.stomach.setPalette(palette);
      set.line.setPalette(palette);
    }
  }

  private applyBody(input: SceneInput) {
    const body = input.body;
    const key = `${body.age}|${body.heightCm}|${body.weightKg}|${this.sexMix}`;
    if (key === this.lastBodyKey) return;
    this.lastBodyKey = key;
    this.figure.setBody(body, this.sexMix);
    this.muscles.setBody(body.sex, this.figure.height, body.weightKg);
    this.places.height = this.figure.height;
    this.placeTorso(body.sex);
  }

  private placeTorso(sex: Sex) {
    const set = this.sets[sex];
    const ref = this.figure.referenceTorso[sex];
    const hips = this.figure.restJoints.get("hips")!;
    const neck = this.figure.restJoints.get("neck")!;
    const scale = neck.distanceTo(hips) / ref.neck.distanceTo(ref.hips);
    set.torso.scale.setScalar(scale);
    set.torso.position.copy(ref.hips).multiplyScalar(-scale);
    // Sideways drift of the reference hips is tiny, but keep the midline honest.
    set.torso.position.x = 0;
    for (const s of ["male", "female"] as const) this.sets[s].torso.visible = s === sex;
    this.figure.group.updateMatrixWorld(true);
    this.limbsDirty = true;
  }

  private rebuildLimbs(set: SexSet) {
    const f = this.figure;
    const tmp = new THREE.Vector3();
    set.torso.updateMatrixWorld(true);
    const inv = set.torso.matrixWorld.clone().invert();
    const toLocal = (world: THREE.Vector3) => world.clone().applyMatrix4(inv);
    const meta = set.anatomy.asset.meta;
    const extreme = (name: string, pick: "high" | "low") => {
      const p = meta.centerlines[name].reduce((a, b) => ((pick === "low" ? b[1] < a[1] : b[1] > a[1]) ? b : a));
      return new THREE.Vector3(p[0], p[1], p[2]);
    };
    const bifurcation = extreme("descending_aorta_b", "low");
    const shoulderL = extreme("left_subclavian_artery_b", "high");
    const shoulderR = extreme("brachiocephalic_artery_b", "high");

    const smooth = (points: THREE.Vector3[], samples: number) => {
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
      return curve.getPoints(samples);
    };
    const inward = (side: 1 | -1, dx: number, dz: number) => new THREE.Vector3(-side * dx, 0, dz);
    const leg = (side: "L" | "R") => {
      const s = side === "L" ? 1 : -1;
      const hip = toLocal(f.worldJoint(`thigh.${side}`, tmp));
      const knee = toLocal(f.worldJoint(`shin.${side}`, tmp));
      const ankle = toLocal(f.worldJoint(`foot.${side}`, tmp));
      const toe = ankle.clone().add(new THREE.Vector3(0, -0.04, 0.12));
      const mid = hip.clone().lerp(knee, 0.5).add(inward(s, 0.012, 0.012));
      const calf = knee.clone().lerp(ankle, 0.5).add(new THREE.Vector3(0, 0, -0.012));
      return smooth([bifurcation, hip.clone().add(inward(s, 0.012, 0.03)), mid, knee.clone().add(new THREE.Vector3(0, 0, -0.018)), calf, ankle, toe], 46);
    };
    const arm = (side: "L" | "R", base: THREE.Vector3) => {
      const s = side === "L" ? 1 : -1;
      const shoulder = toLocal(f.worldJoint(`arm.${side}`, tmp));
      const elbow = toLocal(f.worldJoint(`forearm.${side}`, tmp));
      const wrist = toLocal(f.worldJoint(`hand.${side}`, tmp));
      const hand = wrist.clone().add(wrist.clone().sub(elbow).normalize().multiplyScalar(0.08));
      return smooth([base, shoulder.clone().add(inward(s, 0.01, 0.005)), shoulder.clone().lerp(elbow, 0.5).add(inward(s, 0.012, 0.004)), elbow, elbow.clone().lerp(wrist, 0.5), wrist, hand], 32);
    };
    const limbs = { legL: leg("L"), legR: leg("R"), armL: arm("L", shoulderL), armR: arm("R", shoulderR) };
    set.network.setLimbs(limbs);
  }

  private viewOf(input: SceneInput): View {
    const sites = input.system === "immune" ? illnessSites(input.trajectory.events, input.t, REFERENCE.immune.high / 100) : [];
    const sex = input.body.sex;
    const sitesKey = sites.join();
    const cached = this.view;
    if (cached && cached.sex === sex && cached.sites === sitesKey && cached.input.focus === input.focus && cached.input.process === input.process && cached.input.stop === input.stop && cached.input.system === input.system && cached.input.theme === input.theme) return cached.view;
    this.view = { sex, sites: sitesKey, input: { focus: input.focus, process: input.process, stop: input.stop, system: input.system, theme: input.theme }, view: this.composeView(input, sites) };
    return this.view.view;
  }

  private composeView(input: SceneInput, sites: OrganId[]): View {
    if (input.focus) return { kind: "focus", organ: input.focus, view: FOCUS_VIEWS[input.focus] };
    const process = input.process;
    if (process) {
      const stops = new Map<OrganId, ProcessStop>();
      for (const stop of process.stops) {
        if (!stop.organ) continue;
        const known = stops.get(stop.organ);
        if (!known || stop.share >= known.share) stops.set(stop.organ, stop);
      }
      const spotlight = input.stop === null ? undefined : process.stops.find((s) => s.number === input.stop);
      return { kind: "process", process, stops, lit: spotlight ?? process.stops.find((s) => s.state === "here") ?? null };
    }
    return { kind: "system", view: SYSTEM_VIEWS[input.system], organs: new Set([...systemById(input.system).organs, ...sites].filter((organ) => this.bodyHas(organ))) };
  }

  private eventOf(process: Process): ResolvedEvent | undefined {
    return this.input?.trajectory.events.find((event) => `event:${event.id}` === process.id);
  }

  private refreshWork(tr: Trajectory, t: number) {
    const minute = Math.floor(t);
    if (this.work && this.work.trajectory === tr && this.work.minute === minute) return this.work;
    const activity = new Map<OrganId, number>();
    for (const state of organStates(tr, minute)) activity.set(state.id, Math.max(activity.get(state.id) ?? 0, state.activity));
    // A mind under stress, or flooded with reward, is working too.
    activity.set("brain", Math.max(activity.get("brain") ?? 0, value(tr, "stressLevel", minute) * MOOD.stress, value(tr, "reward", minute) * MOOD.reward));
    let cough = 0;
    for (const event of tr.events) {
      const feeling = event.feelings.find((f) => f.id === "coughing");
      if (feeling) cough = Math.max(cough, feeling.amount * curveStrength(feeling, event.from, event.ends, minute));
    }
    this.work = { trajectory: tr, minute, activity, cough };
    return this.work;
  }

  private activityOf(tr: Trajectory, t: number, organ: OrganId | null) {
    return organ ? this.refreshWork(tr, t).activity.get(organ) ?? 0 : 0;
  }

  // The body has one colour at a time: the accent on the overview, or the colour of what is in focus.
  private ramp(): Ramp {
    const view = this.input ? viewSystemOf(this.input) : "overview";
    return this.ramps[view === "overview" ? ACCENT_SYSTEM : view];
  }

  // How strong the colour is shows how hard the organ is working.
  private tintForWork(activity: number, out: PartLook, ramp: Ramp, style: PartStyle = STOMACH_STYLE) {
    const a = style.tinted ? THREE.MathUtils.clamp(activity, 0, 1) : 0;
    out.tint.copy(ramp.low).lerp(ramp.high, a);
    out.tintAmount = WORK.most * Math.pow(a, WORK.curve);
  }

  private lookFor(organ: OrganId | null, name: PartName | null, style: PartStyle, view: View, input: SceneInput, out: PartLook) {
    const activity = this.activityOf(input.trajectory, input.t, organ ?? style.worksWith);
    const ramp = this.ramp();
    out.lift = 0;
    out.hatch = 0;
    const recede = (faintness: number) => {
      this.tintForWork(0, out, ramp);
      out.ghost = 1;
      out.opacity = style.contextOpacity * faintness;
      out.fill = LOOK.contextFill;
    };
    const standOut = () => {
      out.ghost = style.subjectGhost;
      out.lift = style.subjectLift;
      out.hatch = style.hatch * PALETTES[input.theme].hatch;
      out.opacity = 1;
      out.fill = style.staysOpen ? style.subjectFill : LOOK.restFill;
    };
    // Once the muscle figure takes over, almost everything goes.
    const bare = () => {
      recede(1);
      out.opacity = style.bareOpacity;
    };
    switch (view.kind) {
      case "focus":
        if (style.continues === view.organ) {
          this.tintForWork(0, out, ramp);
          out.ghost = 1;
          out.lift = 1;
          out.opacity = 1;
          out.fill = LOOK.continuingFill;
          return;
        }
        if (organ !== view.organ) return view.view.hides ? bare() : recede(LOOK.focusContextOpacity);
        this.tintForWork(activity, out, ramp, style);
        out.tintAmount = style.tinted ? Math.max(out.tintAmount, WORK.subjectLeast) : 0;
        standOut();
        if (!style.staysOpen) out.ghost = Math.min(out.ghost, LOOK.focusGhost);
        return;
      case "process": {
        // A process is drawn in lines: its stops are outlines, and only the current one has colour.
        const stop = organ ? view.stops.get(organ) : undefined;
        if (!stop) return recede(1);
        const lit = view.lit !== null && view.lit.organ === organ && !view.lit.muscle;
        if (!lit || (organ === "lungs" && name !== "airway")) {
          this.tintForWork(0, out, ramp);
          out.ghost = 1;
          out.lift = 1;
          out.opacity = LOOK.stopOutline.opacity * style.restOpacity;
          out.fill = LOOK.stopOutline.fill;
          return;
        }
        standOut();
        out.tint.copy(ramp.high);
        out.tintAmount = LOOK.litStopTint;
        if (name === "airway") out.ghost = COUGH.ghost;
        return;
      }
      case "system": {
        if (view.view.atRest) {
          this.tintForWork(activity, out, ramp, style);
          out.ghost = style.ghost;
          out.opacity = style.restOpacity;
          out.fill = LOOK.restFill;
          return;
        }
        const subject = (organ !== null && view.organs.has(organ)) || (name !== null && view.view.parts.includes(name));
        if (!subject) return view.view.hides ? bare() : recede(1);
        this.tintForWork(activity, out, ramp, style);
        out.tintAmount = style.tinted ? Math.max(out.tintAmount, WORK.subjectLeast) : 0;
        return standOut();
      }
      default: {
        const unreachable: never = view;
        throw new Error(`Unhandled view ${String(unreachable)}`);
      }
    }
  }

  private presentOrgans(set: SexSet, input: SceneInput, view: View, breathIn: number) {
    const cough = this.refreshWork(input.trajectory, input.t).cough;
    for (const part of set.anatomy.parts.values()) {
      this.lookFor(part.style.organ, part.name, part.style, view, input, part.target);
      part.target.highlight = part.style.organ !== null && (part.style.organ === input.hover || this.crossedByTrack(input, part.style.organ)) ? 1 : 0;
      if (part.name === "airway" && view.kind !== "process") this.lightAirway(part, cough, breathIn);
    }
  }

  // A cough lights the airway wherever the airway is on screen at all.
  private lightAirway(airway: OrganPart, cough: number, breathIn: number) {
    const look = airway.target;
    airway.material.uniforms.uPulse.value = cough > 0 ? breathIn * COUGH.pulse : 0;
    if (cough <= 0 || look.opacity === 0) return;
    const ramp = this.ramp();
    look.tint.copy(ramp.low).lerp(ramp.high, cough);
    look.tintAmount = Math.max(look.tintAmount, COUGH.tint * cough);
    look.ghost = Math.min(look.ghost, 1 - (1 - COUGH.ghost) * cough);
    look.opacity = Math.max(look.opacity, COUGH.leastOpacity * cough);
  }

  private presentStomach(set: SexSet, input: SceneInput, view: View, dt: number, k: number) {
    const look = this.look;
    this.lookFor("stomach", null, STOMACH_STYLE, view, input, look);
    const inFocus = view.kind === "focus" && view.organ === "stomach";
    const onStop = view.kind === "process" && view.stops.has("stomach");
    const isLit = view.kind === "process" && view.lit?.organ === "stomach";
    const receding = !this.isFeatured("stomach", view);
    // What is inside only shows when the stomach is what you are looking at.
    const inside = look.opacity === 0 || receding ? 0 : onStop && !isLit ? LOOK.stomachOnStop : 1;
    const { stomach } = set;
    const wall = stomach.wallMaterial.uniforms;
    easeTo(wall.uGhost, inFocus ? LOOK.stomachFocusGhost : look.ghost, k);
    easeTo(wall.uOpacity, look.opacity, k);
    easeTo(wall.uTintAmount, look.tintAmount, k);
    easeTo(wall.uFill, look.fill, k);
    easeTo(wall.uHighlight, input.hover === "stomach" ? 1 : 0, k);
    wall.uTint.value.lerp(look.tint, k);
    easeTo(stomach.contentsMaterial.uniforms.uOpacity, inside, k);
    easeTo(stomach.esophagusMaterial.uniforms.uOpacity, look.opacity === 0 ? 0 : receding ? LOOK.esophagus.context : LOOK.esophagus.subject, k);
    this.chunksShown += (inside - this.chunksShown) * k;
    stomach.setChunkOpacity(this.chunksShown);
    // A stomach that has fully gone costs nothing until it comes back.
    stomach.group.visible = wall.uOpacity.value > 0.01;
    if (!stomach.group.visible) return;
    // Food keeps its own colours only when you are looking at it; otherwise the pieces stay in the warm ramp.
    this.foodCalm += ((inFocus ? 0 : FOOD_CALM) - this.foodCalm) * k;
    const tr = input.trajectory;
    stomach.update(dt, value(tr, "stomachMl", input.t), look.tint, STOMACH.slowWavesPerMin, this.stomachItems(tr, input.t), value(tr, "emptyingKcalPerMin", input.t));
  }

  private presentVessels(set: SexSet, input: SceneInput, view: View, motion: boolean) {
    const moodName: VesselMood = view.kind === "process" ? "faded" : view.view.vessels;
    const mood = VESSEL_MOODS[moodName];
    const on = input.layers.vessels ? 1 : 0;
    const { arterial, venous } = set.anatomy;
    arterial.color.copy(mood.coloured ? this.colors.artery : this.colors.ink);
    arterial.opacity = mood.artery * on;
    arterial.body = mood.body;
    arterial.wave = motion ? mood.wave : 0;
    venous.color.copy(mood.coloured ? this.colors.vein : this.colors.ink);
    venous.opacity = mood.vein * on;
    venous.body = mood.body;
  }

  private presentBelly(input: SceneInput, view: View, k: number) {
    const looking = view.kind === "focus" && view.organ === "fat";
    const goal = looking ? BELLY_WASH.focus : input.hover === "fat" ? BELLY_WASH.hover : 0;
    this.bellyShown += (goal - this.bellyShown) * k;
    if (Math.abs(this.bellyShown - goal) < 0.002) this.bellyShown = goal;
    this.figure.setBelly(this.bellyShown, this.colors.store);
  }

  // The skin's outline, warmed gently by a fever.
  private presentContour(input: SceneInput, k: number) {
    const fever = THREE.MathUtils.smoothstep(value(input.trajectory, "temperature", input.t), FEVER.fromC, FEVER.fullC);
    this.feverShown += (fever - this.feverShown) * k;
    this.contourColor.copy(this.colors.contour).lerp(this.colors.workHigh, this.feverShown * FEVER.contourWarmth);
    this.figure.setContourColor(this.contourColor);
  }

  // One group's flush from what it has been through: full colour while it works, a calmer one as it
  // repairs and gets sore. Null when nothing is going on in it.
  private flushOf(state: MuscleState): MuscleLevel | null {
    const settling = Math.max(state.soreness, state.repair * MUSCLE_LOOK.repairWeight, state.fatigue * MUSCLE_LOOK.fatigueWeight);
    const level = Math.max(state.work, settling);
    if (level < MUSCLE_RECOVERY.activeAbove) return null;
    const working = state.work / level;
    const ramp = this.ramp();
    return {
      amount: MUSCLE_LOOK.flush.least + (MUSCLE_LOOK.flush.most - MUSCLE_LOOK.flush.least) * Math.sqrt(level),
      color: ramp.calm.clone().lerp(ramp.high, working * working),
    };
  }

  // Worked out once a minute, or when the view changes. The muscles ease toward it every frame.
  private composeMuscleLook(input: SceneInput, view: View) {
    const tr = input.trajectory;
    const minute = Math.floor(input.muscleMinute);
    const focus = view.kind === "focus" && view.organ === "muscle" ? input.focusMuscle : null;
    const cached = this.muscleLook;
    if (cached && cached.view === view && cached.trajectory === tr && cached.minute === minute && cached.focus === focus) return cached;

    const shown: Partial<Record<MuscleGroup, number>> = {};
    const levels: Partial<Record<MuscleGroup, MuscleLevel>> = {};
    const outlined: MuscleGroup[] = [];
    let visible = 0;
    const flush = (opacity: number) => {
      for (const group of MUSCLE_GROUPS) {
        const level = this.flushOf(muscleStateAt(tr.muscleEvents, group, minute));
        if (!level) continue;
        levels[group] = level;
        if (opacity > 0) shown[group] = opacity;
      }
    };
    switch (view.kind) {
      case "focus":
        if (view.organ === "muscle") {
          visible = 1;
          flush(0);
          if (focus && !levels[focus]) levels[focus] = { amount: MUSCLE_LOOK.focusLeast, color: this.ramp().calm };
        }
        break;
      case "process": {
        // Lines only, except the muscle the process is at now.
        const event = this.eventOf(view.process);
        for (const group of event ? event.muscles.map((m) => m.group) : []) {
          shown[group] = MUSCLE_LOOK.outline;
          outlined.push(group);
        }
        for (const stop of view.process.stops) {
          if (stop.muscle && !outlined.includes(stop.muscle)) {
            shown[stop.muscle] = MUSCLE_LOOK.outline;
            outlined.push(stop.muscle);
          }
        }
        const lit = view.lit;
        const litGroups = lit?.muscle ? [lit.muscle] : lit?.organ === "muscle" ? UPTAKE_GROUPS : [];
        for (const group of litGroups) {
          shown[group] = MUSCLE_LOOK.stopShown;
          levels[group] = { amount: MUSCLE_LOOK.stopFlush, color: this.ramp().high };
          const at = outlined.indexOf(group);
          if (at >= 0) outlined.splice(at, 1);
        }
        break;
      }
      case "system": {
        const mood = view.view.muscles;
        if (mood === "figure") {
          visible = 1;
          flush(0);
        } else if (mood === "worked") {
          flush(MUSCLE_LOOK.faint);
        } else if (mood === "uptake") {
          const a = Math.pow(THREE.MathUtils.clamp(this.activityOf(tr, input.t, "muscle"), 0, 1), WORK.curve);
          const ramp = this.ramp();
          const color = ramp.low.clone().lerp(ramp.high, a);
          for (const group of UPTAKE_GROUPS) {
            shown[group] = MUSCLE_LOOK.uptake.least + MUSCLE_LOOK.uptake.gain * a;
            levels[group] = { amount: MUSCLE_LOOK.uptake.flush * a, color };
          }
          flush(MUSCLE_LOOK.faint);
        }
        break;
      }
      default: {
        const unreachable: never = view;
        throw new Error(`Unhandled view ${String(unreachable)}`);
      }
    }
    this.muscleLook = { view, trajectory: tr, minute, focus, visible, shown, outlined, levels };
    return this.muscleLook;
  }

  private presentMuscles(input: SceneInput, view: View, dt: number) {
    const look = this.composeMuscleLook(input, view);
    this.muscles.update(dt, { visible: look.visible, shown: look.shown, outlined: look.outlined, levels: look.levels, palette: PALETTES[input.theme], hover: input.hoverMuscle, focus: look.focus });
  }

  private lymphShown(view: View) {
    return view.kind === "process" ? 0 : view.view.lymph;
  }

  private glycogenAmount(view: View) {
    switch (view.kind) {
      case "focus":
      case "system":
        return view.view.glycogen;
      case "process":
        return 0;
      default: {
        const unreachable: never = view;
        throw new Error(`Unhandled view ${String(unreachable)}`);
      }
    }
  }

  // One colour per thing eaten, from what it is mostly made of, with a count for how much is left.
  private stomachItems(tr: Trajectory, t: number): StomachItem[] {
    const minute = Math.floor(t);
    if (!this.food || this.food.trajectory !== tr || this.food.minute !== minute) {
      const pieces: { color: THREE.Color; count: number }[] = [];
      for (const intake of tr.scenario.intakes) {
        if (intake.at > t) continue;
        const kcal = ledgerAt(tr, intake.id, t)?.stomach ?? 0;
        if (kcal < 4) continue;
        const total = intake.carbsG + intake.fatG + intake.proteinG + 1e-3;
        const color = new THREE.Color(0, 0, 0);
        const add = (hex: string, share: number) => {
          const c = new THREE.Color(hex);
          color.r += c.r * share;
          color.g += c.g * share;
          color.b += c.b * share;
        };
        add(FOOD_COLOR.sugar, intake.sugarG / total);
        add(FOOD_COLOR.starch, (intake.carbsG - intake.sugarG) / total);
        add(FOOD_COLOR.fat, intake.fatG / total);
        add(FOOD_COLOR.protein, intake.proteinG / total);
        pieces.push({ color, count: Math.ceil(kcal / KCAL_PER_CHUNK) });
      }
      this.food = { trajectory: tr, minute, pieces };
    }
    const { pieces } = this.food;
    while (this.stomachItemPool.length < pieces.length) this.stomachItemPool.push({ color: new THREE.Color(), count: 0 });
    this.stomachItemPool.length = pieces.length;
    pieces.forEach((piece, i) => {
      const item = this.stomachItemPool[i];
      item.count = piece.count;
      item.color.copy(piece.color).lerp(this.colors.workLow, this.foodCalm);
    });
    return this.stomachItemPool;
  }

  private partCenter(set: SexSet, name: PartName, out: THREE.Vector3) {
    return out.copy(set.anatomy.part(name).center).applyMatrix4(set.torso.matrixWorld);
  }

  private partAnchor(set: SexSet, name: PartName, out: THREE.Vector3) {
    return out.copy(set.anatomy.part(name).anchor).applyMatrix4(set.torso.matrixWorld);
  }

  // Where a label or a line attaches to an organ. A paired organ answers with the side nearer to
  // `near`, so a line that came along one renal artery ends in that kidney.
  private organAnchor(set: SexSet, id: OrganId, out: THREE.Vector3, near: THREE.Vector3 | null = null): THREE.Vector3 {
    switch (id) {
      case "stomach":
        return out.copy(set.stomach.center).applyMatrix4(set.torso.matrixWorld);
      case "muscle": {
        const f = this.figure;
        const site = (from: string, to: string, t: number, target: THREE.Vector3) => f.worldJoint(from, target).lerp(f.worldJoint(to, this.scratchB), t);
        site("thigh.L", "shin.L", 0.45, out);
        if (!near) return out;
        let best = out.distanceToSquared(near);
        for (const [from, to, t] of [["thigh.R", "shin.R", 0.45], ["arm.L", "forearm.L", 0.5], ["arm.R", "forearm.R", 0.5]] as const) {
          site(from, to, t, this.scratchA);
          const d = this.scratchA.distanceToSquared(near);
          if (d < best) {
            best = d;
            out.copy(this.scratchA);
          }
        }
        return out;
      }
      case "fat": {
        const hips = this.figure.worldJoint("hips", out);
        return out.set(hips.x - this.figure.height * 0.065, hips.y + this.figure.height * 0.04, hips.z + this.figure.height * 0.075);
      }
      case "lungs":
        return this.sideNearest(set, "lung_L", "lung_R", out, near);
      case "kidneys":
        return this.sideNearest(set, "kidney_L", "kidney_R", out, near);
      case "brain":
      case "heart":
      case "liver":
      case "pancreas":
      case "spleen":
      case "bladder":
      case "small_intestine":
      case "large_intestine":
        return this.partAnchor(set, id, out);
      case "ovaries":
        return set.anatomy.has("ovary_L") ? this.sideNearest(set, "ovary_L", "ovary_R", out, near) : this.partAnchor(set, "bladder", out);
      case "uterus":
      case "prostate":
        return this.partAnchor(set, set.anatomy.has(id) ? id : "bladder", out);
      default: {
        const unreachable: never = id;
        throw new Error(`Unhandled organ ${String(unreachable)}`);
      }
    }
  }

  private sideNearest(set: SexSet, left: PartName, right: PartName, out: THREE.Vector3, near: THREE.Vector3 | null) {
    this.partAnchor(set, right, out);
    if (!near) return out;
    this.partAnchor(set, left, this.scratchA);
    return this.scratchA.distanceToSquared(near) < out.distanceToSquared(near) ? out.copy(this.scratchA) : out;
  }

  // The middle of an organ for framing it, both sides of a pair included.
  // Each body has only its own reproductive organs, so a view can't name or light the others.
  private bodyHas(organ: OrganId): boolean {
    const { anatomy } = this.currentSet();
    if (organ === "ovaries") return anatomy.has("ovary_L");
    return organ === "uterus" || organ === "prostate" ? anatomy.has(organ) : true;
  }

  private organCenter(set: SexSet, id: OrganId, out: THREE.Vector3): THREE.Vector3 {
    switch (id) {
      case "large_intestine":
        return this.partCenter(set, id, out);
      case "lungs":
        return this.partCenter(set, "lung_L", out).lerp(this.partCenter(set, "lung_R", this.scratchB), 0.5);
      case "kidneys":
        return this.partCenter(set, "kidney_L", out).lerp(this.partCenter(set, "kidney_R", this.scratchB), 0.5);
      case "ovaries":
        if (!set.anatomy.has("ovary_L")) return this.partCenter(set, "bladder", out);
        return this.partCenter(set, "ovary_L", out).lerp(this.partCenter(set, "ovary_R", this.scratchB), 0.5);
      case "uterus":
      case "prostate":
        return this.partCenter(set, set.anatomy.has(id) ? id : "bladder", out);
      case "muscle":
        return this.figure.worldJoint("hips", out);
      case "fat": {
        this.figure.worldJoint("hips", out);
        return out.set(out.x, out.y + this.figure.height * 0.05, out.z + this.figure.height * 0.03);
      }
      default:
        return this.organAnchor(set, id, out);
    }
  }

  private muscleCenter(group: MuscleGroup, out: THREE.Vector3) {
    this.muscles.anchorOf(group, out, "left");
    if (MUSCLE_VIEWS[group].both) out.lerp(this.muscles.anchorOf(group, this.scratchB, "right"), 0.5);
    return out;
  }

  // The side of a muscle group nearer to `near`, so a line down one leg ends on that leg.
  private muscleAnchor(group: MuscleGroup, out: THREE.Vector3, near: THREE.Vector3 | null) {
    const side = (name: BodySide, target: THREE.Vector3) => this.muscles.anchorOf(group, target, name);
    side("left", out);
    if (!near) return out;
    side("right", this.scratchB);
    return this.scratchB.distanceToSquared(near) < out.distanceToSquared(near) ? out.copy(this.scratchB) : out;
  }

  anchorOf(id: AnchorId, out = new THREE.Vector3()): THREE.Vector3 {
    const set = this.currentSet();
    if (id === "thymus" || id === "airway") return this.partAnchor(set, id, out);
    const group = MUSCLE_GROUPS.find((g) => `muscle:${g}` === id);
    if (group) return this.muscles.anchorOf(group, out);
    const cluster = LYMPH_CLUSTERS.find((c) => `lymph:${c}` === id);
    if (cluster) return this.lymph.anchorOf(cluster, out);
    const organ = ORGANS.find((o) => o === id);
    if (!organ) throw new Error(`Unknown anchor ${id}`);
    return this.organAnchor(set, organ, out);
  }

  // What is lit in the current view, for labels: a few things, most important first. Nothing
  // at the top level, on a process or in close-up, where nothing needs naming this way.
  litAnchors(): { id: AnchorId; name: string }[] {
    const input = this.input;
    if (!input) return [];
    const view = this.viewOf(input);
    if (view.kind !== "system" || view.view.atRest) return [];
    const lit: { id: AnchorId; name: string }[] = [];
    if (view.view.muscles === "figure") {
      const levels = this.composeMuscleLook(input, view).levels;
      for (const group of MUSCLE_GROUPS) if (levels[group]) lit.push({ id: `muscle:${group}`, name: MUSCLE_LABEL[group] });
      return lit;
    }
    for (const organ of view.organs) if (organ !== "fat") lit.push({ id: organ, name: ORGAN_NAME[organ] });
    if (view.view.parts.includes("thymus")) lit.push({ id: "thymus", name: "Thymus" });
    if (view.view.lymph > 0) {
      if (this.refreshWork(input.trajectory, input.t).cough > 0) lit.push({ id: "airway", name: "Windpipe" });
      for (const cluster of LYMPH_CLUSTERS) lit.push({ id: `lymph:${cluster}`, name: LYMPH_NAME[cluster] });
    }
    return lit;
  }

  stopAnchor(stop: ProcessStop, out = new THREE.Vector3()) {
    return this.locateStop(this.currentSet(), stop, this.input?.process ?? null, out);
  }

  // A stop sits on its muscle group or organ, else where its route ends. One with none of these,
  // such as burned, has no place of its own and sits on the stop it branched from.
  private locateStop(set: SexSet, stop: ProcessStop, process: Process | null, out: THREE.Vector3): THREE.Vector3 {
    const stops = process?.stops ?? [];
    let cursor: ProcessStop | undefined = stop;
    for (let hops = 0; cursor && hops <= stops.length; hops++) {
      const last = cursor.routes.length ? set.network.route(cursor.routes[cursor.routes.length - 1]).points : null;
      const routeEnd = last ? this.routeEnd.copy(last[last.length - 1]).applyMatrix4(set.torso.matrixWorld) : null;
      if (cursor.muscle) return this.muscleAnchor(cursor.muscle, out, routeEnd);
      if (cursor.organ) return this.organAnchor(set, cursor.organ, out, routeEnd);
      if (routeEnd) return out.copy(routeEnd);
      const current: ProcessStop = cursor;
      const index = stops.findIndex((s) => s.id === current.id);
      cursor = current.from ? stops.find((s) => s.id === current.from) : stops[index - 1];
    }
    return this.figure.worldJoint("hips", out);
  }

  private crossedByTrack(input: SceneInput, organ: OrganId) {
    return input.track?.crossed?.some((part) => part.organ === organ) ?? false;
  }

  jointAt(name: string, out = new THREE.Vector3()) {
    return this.figure.worldJoint(name, out);
  }

  // Projects a world point into CSS pixels of the canvas.
  project(world: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const p = world.clone().project(this.camera);
    const rect = this.canvas.parentElement!;
    return { x: ((p.x + 1) / 2) * rect.clientWidth, y: ((1 - p.y) / 2) * rect.clientHeight, behind: p.z > 1 };
  }

  pickTarget(clientX: number, clientY: number): PickTarget {
    const input = this.input;
    if (!input) return { organ: null, muscle: null, onBody: false };
    const set = this.sets[input.body.sex];
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const candidates: THREE.Object3D[] = set.stomach.group.visible ? [set.stomach.wall] : [];
    for (const part of set.anatomy.parts.values()) {
      if (part.mesh.visible && part.style.organ && part.name !== "airway") candidates.push(part.mesh);
    }
    const organOf = (object: THREE.Object3D): OrganId | null => (object === set.stomach.wall ? "stomach" : set.anatomy.organOf(object));
    const hits = this.raycaster.intersectObjects(candidates, false);
    const view = this.viewOf(input);
    const muscle = this.muscles.pick(this.raycaster);
    // On a process that runs through muscles, a muscle in front of an organ is what you clicked.
    const musclesFirst = view.kind === "process" && view.stops.has("muscle");
    // What the view is about is what a click means: a contour in front shouldn't steal it.
    for (const hit of hits) {
      const organ = organOf(hit.object);
      if (!organ || !this.isFeatured(organ, view)) continue;
      if (musclesFirst && muscle && muscle.distance < hit.distance) break;
      return { organ, muscle: null, onBody: true };
    }
    if (muscle) return { organ: null, muscle: muscle.group, onBody: true };
    if (this.bellyShown > BELLY_WASH.pickableAbove && this.raycaster.ray.distanceToPoint(this.organCenter(set, "fat", this.scratchA)) < BELLY_WASH.radius * this.figure.height) {
      return { organ: "fat", muscle: null, onBody: true };
    }
    for (const hit of hits) {
      const organ = organOf(hit.object);
      if (organ) return { organ, muscle: null, onBody: true };
    }
    return { organ: null, muscle: null, onBody: false };
  }

  private isFeatured(organ: OrganId, view: View) {
    switch (view.kind) {
      case "focus":
        return organ === view.organ;
      case "process":
        return view.stops.has(organ);
      case "system":
        return view.view.atRest ? !CONTOUR_AT_REST.has(organ) : view.organs.has(organ);
      default: {
        const unreachable: never = view;
        throw new Error(`Unhandled view ${String(unreachable)}`);
      }
    }
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (WALL && now - this.lastT < 1000 / WALL_FPS - 1) return;
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    this.frame(dt);
  };

  // Which way to face so the muscles that were worked can be seen: the groups' own best angles,
  // averaged by how much each was worked, in whole steps so a passing minute doesn't turn the view.
  private workedAzimuth(input: SceneInput): number | null {
    const minute = Math.floor(input.muscleMinute);
    let sin = 0;
    let cos = 0;
    for (const group of MUSCLE_GROUPS) {
      const level = this.flushOf(muscleStateAt(input.trajectory.muscleEvents, group, minute));
      if (!level) continue;
      sin += Math.sin(MUSCLE_VIEWS[group].azimuth) * level.amount;
      cos += Math.cos(MUSCLE_VIEWS[group].azimuth) * level.amount;
    }
    if (sin === 0 && cos === 0) return null;
    return Math.round(Math.atan2(sin, cos) / MUSCLE_LOOK.azimuthStep) * MUSCLE_LOOK.azimuthStep;
  }

  // A stop on a muscle turns the figure to it, so a back muscle isn't seen from inside the body.
  private azimuthForLit(process: Process, spotlight: number | null) {
    const muscle = litMuscleOf(process, spotlight);
    return muscle ? MUSCLE_VIEWS[muscle].azimuth : null;
  }

  // Changes exactly when the camera should go somewhere new.
  private framingKeyOf(input: SceneInput) {
    const body = `${input.body.sex}|${input.body.heightCm}`;
    const posture = this.sit > 0.5 ? "seated" : "standing";
    if (input.focus) return `focus:${input.focus}:${input.focus === "muscle" ? input.focusMuscle : ""}|${input.focus === "muscle" ? posture : ""}|${body}`;
    if (!input.process) {
      const view = SYSTEM_VIEWS[input.system];
      return `system:${input.system}|${view.standingHeight ? posture : ""}|${view.turnsToWork ? this.workedAzimuth(input) : ""}|${body}`;
    }
    return input.stop === null ? `process:${input.process.id}|${litMuscleOf(input.process, null)}|${body}` : `stop:${input.process.id}:${input.stop}|${body}`;
  }

  private framingSourceOf(set: SexSet, input: SceneInput): FramingSource {
    const angled = (angle: ViewAngle, center: (out: THREE.Vector3) => THREE.Vector3, azimuth: number = angle.azimuth): FramingSource => (out) => {
      center(out.target);
      const share = THREE.MathUtils.lerp(angle.standingHeight ?? angle.height, angle.height, this.sit);
      out.height = share * this.figure.height;
      out.width = angle.width * this.figure.height;
      out.azimuth = azimuth;
      out.polar = angle.polar;
      out.headroom = angle.headroom ?? null;
    };
    const withHead = (source: FramingSource): FramingSource => (out) => {
      source(out);
      this.figure.headHeights(out.head);
    };
    const { focus, focusMuscle, process, stop } = input;
    if (focus === "muscle" && focusMuscle) return withHead(angled(MUSCLE_VIEWS[focusMuscle], (out) => this.muscleCenter(focusMuscle, out)));
    if (focus === "muscle") {
      const figure = SYSTEM_VIEWS.muscles;
      return withHead(angled(figure, (out) => figure.center(this.places, out)));
    }
    if (focus) {
      const view = FOCUS_VIEWS[focus];
      return withHead(angled(view, (out) => this.organCenter(set, focus, out), input.track ? TRACK_AZIMUTH[input.track.from] : view.azimuth));
    }
    const systemView = SYSTEM_VIEWS[input.system];
    const turned = systemView.turnsToWork ? this.workedAzimuth(input) : null;
    const systemSource = angled(systemView, (out) => systemView.center(this.places, out), turned ?? systemView.azimuth);
    if (!process) return withHead(systemSource);
    const spot = stop === null ? undefined : process.stops.find((s) => s.number === stop);
    const azimuth = this.azimuthForLit(process, stop);
    if (spot) {
      return withHead((out) => {
        this.locateStop(set, spot, process, out.target);
        out.height = STOP_FRAMING.height * this.figure.height;
        out.width = STOP_FRAMING.width * this.figure.height;
        out.azimuth = azimuth;
        out.polar = null;
        out.headroom = null;
      });
    }
    return withHead((out) => {
      if (set.line.bounds.isEmpty()) return systemSource(out);
      const box = this.boundsWorld.copy(set.line.bounds).applyMatrix4(set.torso.matrixWorld);
      this.figure.headHeights(out.head);
      if (box.max.y > out.head.chin) box.max.y = out.head.top + LINE_FRAMING.overHead;
      // A muscle stop names one side of something on both sides, so the view holds both.
      if (process.stops.some((s) => s.muscle !== null)) {
        const midline = this.figure.worldJoint("hips", this.scratchA).x;
        const reach = Math.max(box.max.x - midline, midline - box.min.x);
        box.min.x = midline - reach;
        box.max.x = midline + reach;
      }
      box.getCenter(out.target);
      const least = LINE_FRAMING.least * this.figure.height;
      out.height = Math.max(least, (box.max.y - box.min.y) * LINE_FRAMING.heightMargin);
      out.width = Math.max(least, (box.max.x - box.min.x) * LINE_FRAMING.widthMargin);
      out.azimuth = azimuth;
      out.polar = null;
      out.headroom = null;
    });
  }

  private frame(dt: number) {
    const input = this.input;
    if (!input) return;
    const motion = !this.reducedMotion.matches;
    const k = 1 - Math.exp(-dt * EASE_RATE);
    this.applyTheme(input.theme);

    // Sex change animates through the shared mesh topology.
    const sexTarget = input.body.sex === "female" ? 1 : 0;
    if (Math.abs(this.sexMix - sexTarget) > 0.001) {
      this.sexMix += (sexTarget - this.sexMix) * (1 - Math.exp(-dt * 6));
      if (Math.abs(this.sexMix - sexTarget) < 0.002) this.sexMix = sexTarget;
    }
    this.applyBody(input);
    const set = this.sets[input.body.sex];
    this.shellFront += ((input.layers.skin ? 1 : 0) - this.shellFront) * k;
    this.figure.setShellOpacity(this.shellFront, this.shellFront * SHELL_BACK_SHARE);

    // Posture is a model output, so the figure sits when the timeline says it is sitting.
    const tr = input.trajectory;
    const postureIndex = Math.round(value(tr, "posture", input.t));
    const posture: Posture = POSTURES[postureIndex];
    const wantSit = posture === "sitting" || posture === "sleeping" ? 1 : 0;
    const wantWalk = posture === "walking" || posture === "running" ? 1 : 0;
    const previousSit = this.sit;
    this.sit += (wantSit - this.sit) * (1 - Math.exp(-dt * 3.2));
    this.walk += (wantWalk - this.walk) * (1 - Math.exp(-dt * 4));
    if (motion) this.walkPhase += dt * (posture === "running" ? 8.5 : 4.6);
    const poseMoving = Math.abs(this.sit - previousSit) > 1e-4 || this.walk > 0.002;
    this.figure.setPose(this.sit, this.walk, this.walkPhase);
    if (poseMoving || this.limbsDirty) {
      this.rebuildLimbs(set);
      this.limbsDirty = false;
    }

    // The camera stays on the torso when the figure sits or stands, so the organs never leave the frame.
    this.figure.worldJoint("hips", this.hipsWorld);
    if (this.framedHipsY !== null && Math.abs(this.hipsWorld.y - this.framedHipsY) > 1e-4) this.rig.translateY(this.hipsWorld.y - this.framedHipsY);
    this.framedHipsY = this.hipsWorld.y;
    // Heartbeat and breathing run at the model's rates.
    this.beat += dt * (value(tr, "hr", input.t) / 60);
    this.breath += dt * (value(tr, "breaths", input.t) / 60);
    const beatPhase = this.beat % 1;
    const lub = motion ? Math.exp(-((beatPhase - 0.08) ** 2) / 0.003) + 0.55 * Math.exp(-((beatPhase - 0.3) ** 2) / 0.005) : 0;
    const heart = set.anatomy.part("heart");
    heart.scalePulse = -0.05 * lub;
    heart.material.uniforms.uPulse.value = lub;
    const inhale = motion ? 0.5 - 0.5 * Math.cos(this.breath * Math.PI * 2) : 0;
    set.anatomy.part("lung_L").scalePulse = 0.018 * inhale;
    set.anatomy.part("lung_R").scalePulse = 0.018 * inhale;
    if (motion) {
      this.clock += dt;
      setMaterialClock(this.clock);
    }

    const view = this.viewOf(input);
    this.presentMuscles(input, view, dt);
    this.presentOrgans(set, input, view, inhale);
    this.presentStomach(set, input, view, dt, k);
    this.presentVessels(set, input, view, motion);
    this.presentBelly(input, view, k);
    this.presentContour(input, k);
    this.lymph.update(dt, this.lymphShown(view), THREE.MathUtils.clamp(value(tr, "immune", input.t), 0, 1));
    set.anatomy.setGlycogen(value(tr, "liverGlycogen", input.t) / LIVER.glycogenMaxG, this.glycogenAmount(view));
    set.anatomy.update(dt, beatPhase);
    set.line.setAccent(this.ramp().high);
    set.line.update(dt, input.process, input.stop, motion);

    // Asking for a new view flies the camera there; a viewer drag cancels the flight.
    const { insets } = input;
    const key = this.framingKeyOf(input);
    if (key !== this.framingKey) {
      const source = this.framingSourceOf(set, input);
      if (this.framingKey === null) this.rig.snap(source, insets);
      else this.rig.fly(source);
      this.framingKey = key;
    }
    this.rig.update(dt, insets, motion);

    // A slow sway until the first touch, so depth reads before anyone drags.
    if (this.idle && motion && !this.rig.flying) {
      this.idleClock += dt;
      this.swayOffset.copy(this.camera.position).sub(this.controls.target);
      this.swayOffset.applyAxisAngle(this.swayAxis, Math.cos(this.idleClock * IDLE_SWAY.rate) * IDLE_SWAY.radiansPerSecond * dt);
      this.camera.position.copy(this.controls.target).add(this.swayOffset);
    }
    this.controls.update();

    this.renderer.render(this.scene, this.camera);
    for (const listener of this.frameListeners) listener(this, dt);
  }
}

