import { useEffect, useRef } from "react";
import { foodOrigin } from "../model/origin";
import { kcalOf, Intake } from "../model/scenario";
import { formatClock } from "../model/state";
import { dispatch, setUi, useStore } from "../store";
import { X } from "./icons";
import { sourced } from "./SourceTip";

const SERVING_STEP = 0.5;
const GRAM_STEP = { large: 25, small: 10, largeFrom: 100 };
const TIME_STEP_MIN = 15;
const CAFFEINE_SHOWN_BELOW_KCAL = 30;
const HALF = "½";

const countText = (count: number) => {
  const whole = Math.floor(count + 1e-6);
  const part = count - whole;
  if (Math.abs(part - 0.5) < 0.01) return whole ? `${whole}${HALF}` : HALF;
  return part < 0.01 ? String(whole) : count.toFixed(1);
};

const plural = (label: string, count: number) => {
  if (count <= 1) return label;
  return /(s|x|ch|sh)$/.test(label) ? `${label}es` : `${label}s`;
};

// How much was had, in the units it was eaten in, and the next amounts down and up from there.
function portion(intake: Intake): { text: string; less: number; more: number } {
  const { serving, grams } = intake;
  if (serving) {
    const count = grams / serving.grams;
    const steps = count / SERVING_STEP;
    const down = (Math.ceil(steps - 1e-6) - 1) * SERVING_STEP;
    const up = (Math.floor(steps + 1e-6) + 1) * SERVING_STEP;
    return { text: `${countText(count)} ${plural(serving.label, count)}`, less: down * serving.grams, more: up * serving.grams };
  }
  const step = grams >= GRAM_STEP.largeFrom ? GRAM_STEP.large : GRAM_STEP.small;
  return { text: `${Math.round(grams)} g`, less: (Math.ceil(grams / step - 1e-6) - 1) * step, more: (Math.floor(grams / step + 1e-6) + 1) * step };
}

const portionWords = (intake: Intake, grams: number) => portion({ ...intake, grams }).text;

function holds(intake: Intake): string {
  const kcal = kcalOf(intake);
  const what = intake.caffeineMg > 0 && kcal < CAFFEINE_SHOWN_BELOW_KCAL ? `${Math.round(intake.caffeineMg)} mg caffeine` : `${Math.round(kcal)} kcal`;
  return `${Math.round(intake.grams)} g, ${what}`;
}

const sourceWords = (intake: Intake) => (intake.source?.kind === "table" ? `USDA: ${intake.source.name}` : intake.source?.kind === "recipe" ? "Claude's recipe, USDA ingredients" : "Claude's estimate");

function Stepper({ text, label, onLess, onMore, canLess }: { text: string; label: string; onLess: () => void; onMore: () => void; canLess: boolean }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Less, ${label}`} disabled={!canLess} onClick={onLess}>
        −
      </button>
      <span className="stepper-value">{text}</span>
      <button type="button" aria-label={`More, ${label}`} onClick={onMore}>
        +
      </button>
    </span>
  );
}

function FoodRow({ intake }: { intake: Intake }) {
  const { text, less, more } = portion(intake);
  const correct = (grams: number) => dispatch({ name: "correct_intake", args: { id: intake.id, grams, assumption: portionWords(intake, grams) } });
  return (
    <div className="fix-row">
      <span className="fix-name">{intake.label}</span>
      <button type="button" className="link fix-remove" onClick={() => dispatch({ name: "remove_intake", args: { id: intake.id } })}>
        Remove
      </button>
      <Stepper text={text} label={`how much ${intake.label}`} canLess={less > 0} onLess={() => correct(less)} onMore={() => correct(more)} />
      <p className="fix-note" {...sourced(foodOrigin(intake))}>
        {holds(intake)}. {sourceWords(intake)}
      </p>
    </div>
  );
}

// What was eaten at one moment on the chart. Every step redraws the curves behind it straight away.
export function FoodFix() {
  const fixing = useStore((s) => s.fixing);
  const intakes = useStore((s) => s.body.intakes);
  const root = useRef<HTMLDivElement>(null);
  const shown = fixing ? intakes.filter((intake) => fixing.ids.includes(intake.id)) : [];
  const open = fixing !== null && shown.length > 0;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setUi({ fixing: null });
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (fixing && !shown.length) setUi({ fixing: null });
  }, [fixing, shown.length]);

  if (!open) return null;
  const at = shown[0].at;
  const move = (by: number) => {
    for (const intake of shown) dispatch({ name: "correct_intake", args: { id: intake.id, at: intake.at + by } });
    const s = at + by;
    setUi({ t: s });
  };
  return (
    <div ref={root} className="fix" role="dialog" aria-label="Correct what you had" style={{ "--fix-x": `${fixing.x}px` }}>
      <div className="fix-head">
        <Stepper text={formatClock(at)} label="when" canLess onLess={() => move(-TIME_STEP_MIN)} onMore={() => move(TIME_STEP_MIN)} />
        <button type="button" className="icon-button" aria-label="Close" onClick={() => setUi({ fixing: null })}>
          <X />
        </button>
      </div>
      {shown.map((intake) => (
        <FoodRow key={intake.id} intake={intake} />
      ))}
    </div>
  );
}
