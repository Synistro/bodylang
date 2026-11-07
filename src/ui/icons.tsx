import {
  ArrowUp,
  Bandaids,
  Barbell,
  BatteryLow,
  Bed,
  BowlFood,
  Brain,
  Dna,
  Drop,
  Eye,
  Fire,
  ForkKnife,
  Heartbeat,
  Icon,
  IconProps,
  Leaf,
  Lightning,
  Moon,
  CaretUpDown,
  Check,
  Copy,
  GithubLogo,
  Pause,
  PersonSimple,
  Play,
  ShieldPlus,
  Sparkle,
  SkipBack,
  SkipForward,
  Thermometer,
  ThermometerSimple,
  Vibrate,
  Virus,
  Waves,
  Waveform,
  Wind,
  X,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { SystemId } from "../model/ids";

// Icons are for finding your way and for controls everybody already knows: the list of systems you
// keep returning to, what you may feel, and play, skip, send, close. Other text stays in words.
export type Glyph = Icon | ((props: IconProps) => ReactNode);

// Two organs the icon set doesn't draw, on its 256 grid and in its thin stroke, so they sit beside it.
function Organ({ size = "1em", className, shape, line }: IconProps & { shape: string; line?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth="12"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={shape} />
      {line ? <path d={line} /> : null}
    </svg>
  );
}

const Stomach = (props: IconProps) => (
  <Organ
    {...props}
    shape="M122 24V70C122 104 112 124 88 130C72 134 56 130 30 122V164C44 168 50 170 54 176C70 208 106 232 152 226C200 220 232 176 230 128C228 84 192 56 152 62V24Z"
    line="M170 112C186 132 184 164 160 184"
  />
);

const Kidney = (props: IconProps) => (
  <Organ
    {...props}
    shape="M136 28C88 26 40 66 36 124C32 174 66 216 110 212C142 209 152 184 140 162C134 150 124 142 126 124C128 106 144 100 156 88C176 66 164 30 136 28Z"
    line="M130 128C176 130 196 166 204 228"
  />
);

export const SYSTEM_GLYPH: Record<SystemId, Glyph> = {
  overview: PersonSimple,
  digestion: Stomach,
  energy: Lightning,
  circulation: Heartbeat,
  muscles: Barbell,
  brain: Brain,
  immune: ShieldPlus,
  clearing: Kidney,
  reproductive: Dna,
};

// What you may feel, each in the colour of the part of the body it comes from. A feeling Claude described
// for something with no built-in curve has the plain mark.
export const FEELING_LOOK: Record<string, { glyph: Glyph; system: SystemId }> = {
  full: { glyph: BowlFood, system: "digestion" },
  hungry: { glyph: ForkKnife, system: "digestion" },
  warm: { glyph: ThermometerSimple, system: "circulation" },
  hot: { glyph: Fire, system: "circulation" },
  breathless: { glyph: Wind, system: "circulation" },
  tense: { glyph: Waveform, system: "circulation" },
  sleepy: { glyph: Moon, system: "brain" },
  tired: { glyph: Bed, system: "brain" },
  alert: { glyph: Eye, system: "brain" },
  jittery: { glyph: Vibrate, system: "brain" },
  relaxed: { glyph: Leaf, system: "brain" },
  low: { glyph: BatteryLow, system: "energy" },
  sore: { glyph: Barbell, system: "muscles" },
  thirsty: { glyph: Drop, system: "clearing" },
  coughing: { glyph: Virus, system: "immune" },
  feverish: { glyph: Thermometer, system: "immune" },
  stuffy: { glyph: Wind, system: "immune" },
  sore_throat: { glyph: Bandaids, system: "immune" },
  cramps: { glyph: Waves, system: "reproductive" },
};

export const FEELING_FROM_CLAUDE = Sparkle;

export { ArrowUp, CaretUpDown, Check, Copy, GithubLogo, Pause, Play, SkipBack, SkipForward, X };
