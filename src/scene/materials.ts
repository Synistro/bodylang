import * as THREE from "three";
import type { Theme } from "../look";

export interface Palette {
  background: string;
  ink: string; // contours
  tone1: string; // lit side of an organ
  tone2: string;
  tone3: string; // shadow side
  cavity: string; // inside of a cut organ
  workLow: string; // food in the stomach, settling toward this as it breaks down
  workHigh: string; // the warmth a fever gives the skin's outline
  contour: string; // the skin's outline
  artery: string;
  vein: string;
  store: string; // what a stored reserve fills up with
  hatch: number; // how strongly fine engraved lines show: a light line on a dark plate reads far stronger
}

export const PALETTES: Record<Theme, Palette> = {
  light: {
    background: "#ffffff",
    ink: "#17181a",
    tone1: "#ffffff",
    tone2: "#f1f1f1",
    tone3: "#e6e6e5",
    cavity: "#ececeb",
    workLow: "#d6e4f5",
    workHigh: "#bc5215",
    contour: "#5c5b56",
    artery: "#af3029",
    vein: "#205ea6",
    store: "#ad8301",
    hatch: 1,
  },
  dark: {
    background: "#110f0e",
    ink: "#d0cec6",
    tone1: "#343331",
    tone2: "#232221",
    tone3: "#1d1b1a",
    cavity: "#5e4438",
    workLow: "#6a3a22",
    workHigh: "#d97540",
    contour: "#b7b5ac",
    artery: "#d14d41",
    vein: "#4385be",
    store: "#d0a215",
    hatch: 0.3,
  },
};

// Shared by every material, so a contour has the same weight wherever it is drawn.
const lineDevicePixels = { value: 1.3 };
export const hullCssPixels = { value: 0.8 };
const HULL_SHARE_OF_LINE = 0.89;
const clock = { value: 0 };

export function setContourWeight(cssPixels: number, pixelRatio: number) {
  lineDevicePixels.value = cssPixels * pixelRatio;
  hullCssPixels.value = cssPixels * HULL_SHARE_OF_LINE;
}

// Slow surface motion in materials reads this. Holding it still is what reduced motion asks for.
export function setMaterialClock(seconds: number) {
  clock.value = seconds;
}


const ORGAN_VERT = /* glsl */ `
  attribute float aAlong;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec3 vLocal;
  varying float vAlong;
  void main() {
    vLocal = position;
    vAlong = aAlong;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Tones stepped softly, the way an engraved plate shades a form, then a tint that rises with how
// hard the organ is working. Ghost mode trades the fill for a thin line. The line width comes from
// how fast the surface turns on screen, so a contour weighs the same at any zoom.
const ORGAN_FRAG = /* glsl */ `
  uniform vec3 uTone1;
  uniform vec3 uTone2;
  uniform vec3 uTone3;
  uniform vec3 uInk;
  uniform vec3 uCavity;
  uniform vec3 uTint;
  uniform float uTintAmount;
  uniform float uGhost;
  uniform float uOpacity;
  uniform float uPulse;
  uniform float uHighlight;
  uniform float uFill;
  uniform float uLift;
  uniform float uSoft;
  uniform float uHatch;
  uniform float uHatchRound;
  uniform float uLinePx;
  uniform float uClock;
  uniform vec3 uStore;
  uniform float uLevel;
  uniform float uLevelAmount;
  uniform vec2 uLevelRange;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec3 vLocal;
  varying float vAlong;

  void main() {
    vec3 n = normalize(vNormalV);
    vec3 v = normalize(vViewDir);
    if (!gl_FrontFacing) n = -n;
    float ndl = dot(n, normalize(vec3(-0.45, 0.75, 0.6)));
    float stepped = smoothstep(-0.26, -0.08, ndl) * 0.5 + smoothstep(0.36, 0.56, ndl) * 0.5;
    float steps = mix(mix(stepped, smoothstep(-0.75, 0.85, ndl), uSoft), 1.0, uLift);
    vec3 color = mix(uTone3, mix(uTone2, uTone1, smoothstep(0.5, 1.0, steps)), smoothstep(0.0, 0.5, steps));
    float facing = clamp(abs(dot(n, v)), 0.0, 1.0);
    float rim = 1.0 - facing;

    float tint = uTintAmount * (0.84 + 0.16 * uPulse);
    color = mix(color, uTint * mix(0.88, 1.06, steps), tint);
    color = mix(color, uInk, smoothstep(0.82, 1.0, rim) * 0.22 * (1.0 - uLift));
    color = mix(color, uTint, uHighlight * 0.18);
    // A cut face is a soft pale tone of the organ's own colour: darker reads as diseased.
    if (!gl_FrontFacing) color = mix(uCavity, uTint, tint * 0.42);

    // Fine engraved lines, the same treatment as muscle fibres. They swell and darken as the surface
    // turns from the light, which is what gives a pale organ its form, and fade by their own screen
    // density, so from afar the tissue reads as one clean tone.
    float fineCycle = mix(dot(vLocal, vec3(0.42, 0.82, 0.38)) / 0.0026, vAlong / 0.0018, uHatchRound);
    float fineBlur = max(fwidth(fineCycle), 1e-4);
    float fineShadow = smoothstep(0.62, -0.25, ndl);
    float fineHalf = mix(0.05, 0.2, fineShadow);
    float fine = (1.0 - smoothstep(fineHalf - fineBlur, fineHalf + fineBlur, abs(fract(fineCycle + 0.5) - 0.5))) * (1.0 - smoothstep(0.2, 0.46, fineBlur));
    color = mix(color, mix(uInk, uTint * 0.45, clamp(tint * 2.0, 0.0, 1.0)), fine * uHatch * mix(0.12, 1.0, fineShadow));

    // A reserve fills the organ from the bottom like a vessel, engraved with level lines.
    float height = (vLocal.y - uLevelRange.x) / (uLevelRange.y - uLevelRange.x);
    float heightStep = max(fwidth(height), 1e-4);
    float surface = uLevel + 0.006 * sin(vLocal.x * 70.0 + uClock * 0.8) * uLevelAmount;
    float filled = 1.0 - smoothstep(surface - heightStep, surface + heightStep, height);
    float meniscus = 1.0 - smoothstep(heightStep * 0.8, heightStep * 1.9, abs(height - surface));
    float hatchCycle = vLocal.y / 0.0042;
    float hatchBlur = max(fwidth(hatchCycle), 1e-4);
    float hatch = (1.0 - smoothstep(0.14, 0.14 + hatchBlur, abs(fract(hatchCycle) - 0.5))) * (1.0 - smoothstep(0.25, 0.5, hatchBlur));
    color = mix(color, uStore, filled * uLevelAmount * 0.22);
    color = mix(color, uInk, filled * hatch * uLevelAmount * 0.1);
    color = mix(color, uInk, meniscus * uLevelAmount * 0.75);

    float lineWidth = max(fwidth(facing), 1e-4) * uLinePx;
    float line = 1.0 - smoothstep(lineWidth * 0.55, lineWidth * 1.25, facing);
    float contour = max(line * 0.82, smoothstep(0.72, 0.97, rim) * 0.3);
    float wash = max(uTintAmount * 0.55, max(uHighlight * 0.45, uFill));
    float ghostAlpha = max(contour, wash * (0.42 + rim * 0.5));
    vec3 ghostInk = mix(uInk, uTone2, 0.3);
    vec3 ghostColor = mix(mix(ghostInk, mix(uTone3, uTone1, uLift), (1.0 - contour) * mix(0.7, 1.0, uLift)), uTint, clamp(uTintAmount * 1.4, 0.0, 1.0));
    gl_FragColor = vec4(mix(color, ghostColor, uGhost), mix(1.0, ghostAlpha, uGhost) * uOpacity);
    #include <colorspace_fragment>
  }
`;

export function createOrganMaterial(palette: Palette): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ORGAN_VERT,
    fragmentShader: ORGAN_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    uniforms: {
      uTone1: { value: new THREE.Color(palette.tone1) },
      uTone2: { value: new THREE.Color(palette.tone2) },
      uTone3: { value: new THREE.Color(palette.tone3) },
      uInk: { value: new THREE.Color(palette.ink) },
      uCavity: { value: new THREE.Color(palette.cavity) },
      uTint: { value: new THREE.Color("#ffffff") },
      uTintAmount: { value: 0 },
      uGhost: { value: 0 },
      uOpacity: { value: 1 },
      uPulse: { value: 0 },
      uHighlight: { value: 0 },
      uFill: { value: 0.12 },
      uLift: { value: 0 },
      uSoft: { value: 0 },
      uHatch: { value: 0 },
      uLinePx: lineDevicePixels,
      uClock: clock,
      uHatchRound: { value: 0 },
      uStore: { value: new THREE.Color(palette.store) },
      uLevel: { value: 0 },
      uLevelAmount: { value: 0 },
      uLevelRange: { value: new THREE.Vector2(0, 1) },
    },
  });
}

// Pieces of food in the stomach: a plain two-tone solid with one colour per instance.
const CHUNK_VERT = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vColorV;
  void main() {
    vColorV = instanceColor;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const CHUNK_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vNormalV;
  varying vec3 vColorV;
  void main() {
    float ndl = dot(normalize(vNormalV), normalize(vec3(-0.45, 0.75, 0.6)));
    gl_FragColor = vec4(vColorV * mix(0.84, 1.05, smoothstep(-0.6, 0.8, ndl)), uOpacity);
    #include <colorspace_fragment>
  }
`;

export function createChunkMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: CHUNK_VERT,
    fragmentShader: CHUNK_FRAG,
    transparent: true,
    uniforms: { uOpacity: { value: 1 } },
  });
}

const OUTLINE_VERT = /* glsl */ `
  uniform float uWidth;
  uniform vec2 uResolution;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mvPosition;
    vec3 nv = normalize(normalMatrix * normal);
    vec2 nc = normalize((projectionMatrix * vec4(nv, 0.0)).xy + 1e-5);
    clip.xy += nc * uWidth * 2.0 * clip.w / uResolution;
    gl_Position = clip;
  }
`;

const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uInk, uOpacity);
    #include <colorspace_fragment>
  }
`;

// A slightly inflated back-face hull: crisp contours with no post-processing pass.
export function createOutlineMaterial(palette: Palette, resolution: THREE.Vector2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
    transparent: true,
    uniforms: {
      uInk: { value: new THREE.Color(palette.ink) },
      uOpacity: { value: 1 },
      uWidth: hullCssPixels,
      uResolution: { value: resolution },
    },
  });
}

const SHELL_VERT = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  attribute float aBelly;
  attribute float aOpening;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying float vBelly;
  varying float vOpening;
  void main() {
    vBelly = aBelly;
    vOpening = aOpening;
    #include <skinbase_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    vNormalV = normalize(normalMatrix * objectNormal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// The skin is drawn as a contour only: it tells you where the body ends and stays out of the way.
// Belly fat has no mesh of its own, so looking at it directly shows a wash here. The back faces
// carry the wash so organs draw over it, and the front faces add only the edge.
const SHELL_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform float uOpacity;
  uniform float uLineAlpha;
  uniform float uLinePx;
  uniform float uFill;
  uniform vec3 uBellyColor;
  uniform float uBellyAmount;
  uniform float uBellyBody;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying float vBelly;
  varying float vOpening;
  void main() {
    float facing = clamp(abs(dot(normalize(vNormalV), normalize(vViewDir))), 0.0, 1.0);
    float rim = 1.0 - facing;
    float lineWidth = max(fwidth(facing), 1e-4) * uLinePx * 1.25;
    float line = 1.0 - smoothstep(lineWidth * 0.55, lineWidth * 1.25, facing);
    float haze = pow(rim, 3.0) * 0.12 + uFill;
    // The rims of the eyes and mouth fold back into the head, and would draw as rings.
    float inkAlpha = max(line * uLineAlpha, haze) * uOpacity * (1.0 - vOpening);
    float washAlpha = vBelly * uBellyAmount * mix(rim * rim, 1.0, uBellyBody);
    float alpha = inkAlpha + washAlpha * (1.0 - inkAlpha);
    gl_FragColor = vec4(mix(uBellyColor, uInk, inkAlpha / max(alpha, 1e-3)), alpha);
    #include <colorspace_fragment>
  }
`;

export function createShellMaterial(palette: Palette, side: THREE.Side, opacity: number): THREE.ShaderMaterial {
  const isBack = side === THREE.BackSide;
  return new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    depthWrite: false,
    side,
    uniforms: {
      uInk: { value: new THREE.Color(palette.ink) },
      uOpacity: { value: opacity },
      uLineAlpha: { value: isBack ? 0.3 : 0.86 },
      uLinePx: lineDevicePixels,
      uFill: { value: 0.01 },
      uBellyColor: { value: new THREE.Color(palette.store) },
      uBellyAmount: { value: 0 },
      uBellyBody: { value: isBack ? 1 : 0 },
    },
  });
}

// At rest a vessel is a pair of faint lines. As the subject of a view it fills out into a tube, and
// a soft wave leaves the heart with each beat.
const VESSEL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uBody;
  uniform float uWave;
  uniform float uBeat;
  uniform vec3 uHeart;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec3 vLocal;
  void main() {
    float rim = 1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir)));
    float alpha = mix(0.35 + 0.65 * smoothstep(0.1, 0.8, rim), 0.74 + 0.26 * rim, uBody);
    float travel = fract(uBeat - distance(vLocal, uHeart) / 0.55);
    float wave = smoothstep(0.0, 0.07, travel) * (1.0 - smoothstep(0.07, 0.4, travel)) * uWave;
    vec3 color = mix(uColor * (1.0 - 0.22 * rim * uBody), vec3(1.0), wave * 0.22);
    gl_FragColor = vec4(color, min(1.0, alpha + wave * 0.2) * uOpacity);
    #include <colorspace_fragment>
  }
`;

export function createVesselMaterial(color: string, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ORGAN_VERT,
    fragmentShader: VESSEL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uBody: { value: 0 },
      uWave: { value: 0 },
      uBeat: { value: 0 },
      uHeart: { value: new THREE.Vector3() },
    },
  });
}

const NODE_VERT = /* glsl */ `
  attribute float aSize;
  uniform float uPixelRatio;
  uniform float uLevel;
  varying float vSizePx;
  void main() {
    vSizePx = aSize * uPixelRatio * (1.0 + uLevel * 0.25);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = vSizePx;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// A schematic mark, open while the node is quiet, filling in and swelling as it works.
const NODE_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uTint;
  uniform float uLevel;
  uniform float uOpacity;
  varying float vSizePx;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float blur = 2.0 / vSizePx;
    float disc = 1.0 - smoothstep(1.0 - blur, 1.0, d);
    float hole = 1.0 - smoothstep(0.58 - blur, 0.58, d);
    float filled = smoothstep(0.15, 0.85, uLevel);
    float alpha = disc * mix(1.0, filled * 0.8, hole) * uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(mix(uInk, uTint, hole * filled), alpha);
    #include <colorspace_fragment>
  }
`;

export function createNodeMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: NODE_VERT,
    fragmentShader: NODE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uInk: { value: new THREE.Color() },
      uTint: { value: new THREE.Color() },
      uLevel: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: pixelRatio },
    },
  });
}

export const MAX_LINE_SEGMENTS = 16;

// A ribbon a constant number of screen pixels wide, whatever the zoom. Each vertex knows its
// neighbours, so it can turn the line's direction on screen into a sideways offset.
const LINE_VERT = /* glsl */ `
  attribute vec3 aPrev;
  attribute vec3 aNext;
  attribute float aSide;
  attribute float aAlong;
  attribute float aSegment;
  uniform vec2 uResolution;
  uniform vec3 uSegments[${MAX_LINE_SEGMENTS}]; // width in px, alpha, length revealed so far
  uniform float uAccents[${MAX_LINE_SEGMENTS}]; // 0 ink, 1 the accent
  varying float vAcross;
  varying float vAlong;
  varying float vReach;
  varying float vAlpha;
  varying float vRevealed;
  varying float vAccent;
  void main() {
    int index = int(aSegment + 0.5);
    vec3 segment = uSegments[index];
    vAccent = uAccents[index];
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mvPosition;
    vec4 clipPrev = projectionMatrix * modelViewMatrix * vec4(aPrev, 1.0);
    vec4 clipNext = projectionMatrix * modelViewMatrix * vec4(aNext, 1.0);
    vec2 onScreen = (clipNext.xy / clipNext.w - clipPrev.xy / clipPrev.w) * uResolution;
    float onScreenLength = length(onScreen);
    vec2 direction = onScreenLength > 1e-3 ? onScreen / onScreenLength : vec2(1.0, 0.0);
    float reach = segment.x * 0.5 + 1.0;
    clip.xy += vec2(-direction.y, direction.x) * aSide * reach * 2.0 * clip.w / uResolution;
    vAcross = aSide;
    vAlong = aAlong;
    vReach = reach;
    vAlpha = segment.y;
    vRevealed = segment.z;
    gl_Position = clip;
  }
`;

const LINE_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform float uDepthAlpha;
  varying float vAccent;
  varying float vAcross;
  varying float vAlong;
  varying float vReach;
  varying float vAlpha;
  varying float vRevealed;
  void main() {
    if (vAlong > vRevealed) discard;
    float edge = 1.0 - smoothstep(vReach - 1.5, vReach - 0.5, abs(vAcross) * vReach);
    float alpha = edge * vAlpha * uDepthAlpha;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(mix(uInk, uAccent, vAccent), alpha);
    #include <colorspace_fragment>
  }
`;

export interface LineUniforms {
  segments: { value: THREE.Vector3[] };
  accents: { value: Float32Array };
  ink: { value: THREE.Color };
  accent: { value: THREE.Color };
}

// Drawn twice: depth-tested at full strength, then again where a solid organ covers it, so the
// line carries on visibly through whatever it enters.
export function createLineMaterial(shared: LineUniforms, resolution: THREE.Vector2, depthFunc: THREE.DepthModes, depthAlpha: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc,
    side: THREE.DoubleSide,
    uniforms: {
      uSegments: shared.segments,
      uAccents: shared.accents,
      uInk: shared.ink,
      uAccent: shared.accent,
      uResolution: { value: resolution },
      uDepthAlpha: { value: depthAlpha },
    },
  });
}

const BEAD_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aAccent;
  uniform float uPixelRatio;
  varying float vSizePx;
  varying float vAlpha;
  varying float vAccent;
  void main() {
    vSizePx = aSize * uPixelRatio;
    vAlpha = aAlpha;
    vAccent = aAccent;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = vSizePx;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// A bead has a paper-coloured ring, so it reads as a thing sitting on a line of its own colour.
const BEAD_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform vec3 uRing;
  uniform float uDepthAlpha;
  varying float vSizePx;
  varying float vAlpha;
  varying float vAccent;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float blur = 2.0 / vSizePx;
    float disc = 1.0 - smoothstep(1.0 - blur, 1.0, d);
    float core = 1.0 - smoothstep(0.66 - blur, 0.66, d);
    float alpha = disc * vAlpha * uDepthAlpha;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(mix(uRing, mix(uInk, uAccent, vAccent), core), alpha);
    #include <colorspace_fragment>
  }
`;

export interface BeadUniforms {
  ink: { value: THREE.Color };
  accent: { value: THREE.Color };
  ring: { value: THREE.Color };
  pixelRatio: { value: number }; // device pixels per unit of aSize
}

export function createBeadMaterial(shared: BeadUniforms, depthFunc: THREE.DepthModes, depthAlpha: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: BEAD_VERT,
    fragmentShader: BEAD_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc,
    uniforms: {
      uInk: shared.ink,
      uAccent: shared.accent,
      uRing: shared.ring,
      uPixelRatio: shared.pixelRatio,
      uDepthAlpha: { value: depthAlpha },
    },
  });
}
