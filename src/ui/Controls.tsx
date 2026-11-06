import { useEffect, useRef } from "react";
import { POSTURES, Posture, Sex } from "../model/scenario";
import { value } from "../model/engine/trajectory";
import { modelOrigin, Origin } from "../model/origin";
import { formatClock } from "../model/words";
import { getState, setBody, setPostureNow, setUi, useStore } from "../store";
import { sourced } from "./SourceTip";

const SEXES: Sex[] = ["male", "female"];
const POSTURE_CHOICES: Posture[] = ["sitting", "standing", "walking"];
const YOURS: Origin = { kind: "you", detail: "Your measurements. The model starts from a typical body with these." };
const FROM_FORMULA = (source: string) => sourced(modelOrigin("A", source));

function Slider({ id, label, unit, min, max, step, value: v, onChange }: { id: string; label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (n: number) => void }) {
  return (
    <label className="slider" htmlFor={id}>
      <span className="slider-label">{label}</span>
      <input id={id} type="range" min={min} max={max} step={step} value={v} onChange={(e) => onChange(Number(e.target.value))} style={{ "--fill": `${((v - min) / (max - min)) * 100}%` }} />
      <span className="slider-value">
        {v} <small>{unit}</small>
      </span>
    </label>
  );
}

export function Header() {
  const body = useStore((s) => s.body.body);
  const t = useStore((s) => Math.round(s.t));
  const now = useStore((s) => s.body.now);
  const tr = useStore((s) => s.trajectory);
  const open = useStore((s) => s.bodyOpen);
  const root = useRef<HTMLElement>(null);
  const a = tr.anthro;
  const currentPosture = POSTURES[Math.round(value(tr, "posture", now))];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setUi({ bodyOpen: false });
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  return (
    <header ref={root} className="header">
      <div className="clock">
        <span className="clock-time">{formatClock(t)}</span>
        {Math.abs(t - now) > 1 ? <span className="clock-state">{t > now ? "forecast" : "earlier"}</span> : null}
      </div>
      <button type="button" className="body-toggle" aria-expanded={open} onClick={() => setUi({ bodyOpen: !open })} {...sourced(YOURS)}>
        {body.sex === "male" ? "Male" : "Female"}, {body.age} y, {body.heightCm} cm, {body.weightKg} kg
      </button>
      {open ? (
        <div className="body-panel">
          <div className="segmented" role="radiogroup" aria-label="Sex">
            {SEXES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={body.sex === s} onClick={() => setBody({ sex: s })}>
                {s === "male" ? "Male" : "Female"}
              </button>
            ))}
          </div>
          <Slider id="age" label="Age" unit="y" min={18} max={90} step={1} value={body.age} onChange={(n) => setBody({ age: n })} />
          <Slider id="height" label="Height" unit="cm" min={150} max={200} step={1} value={body.heightCm} onChange={(n) => setBody({ heightCm: n })} />
          <Slider id="weight" label="Weight" unit="kg" min={45} max={130} step={1} value={body.weightKg} onChange={(n) => setBody({ weightKg: n })} />
          <div className="segmented" role="radiogroup" aria-label="Posture now">
            {POSTURE_CHOICES.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={currentPosture === p} onClick={() => setPostureNow(p)}>
                {p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <dl className="derived">
            <div {...FROM_FORMULA("Weight divided by height squared.")}><dt>BMI</dt><dd>{a.bmi.toFixed(1)}</dd></div>
            <div {...FROM_FORMULA("Boer's formula for lean body mass.")}><dt>Lean</dt><dd>{a.leanKg.toFixed(0)} kg</dd></div>
            <div {...FROM_FORMULA("Nadler's formula for blood volume.")}><dt>Blood</dt><dd>{a.bloodVolumeL.toFixed(1)} L</dd></div>
            <div {...FROM_FORMULA("The Mifflin-St Jeor equation for resting energy use.")}><dt>Rest</dt><dd>{Math.round(a.bmrKcalPerDay)} kcal/d</dd></div>
          </dl>
        </div>
      ) : null}
    </header>
  );
}

// What the figure is drawn with. Bright is on, and faint is off.
export function ViewControls() {
  const layers = useStore((s) => s.layers);
  const theme = useStore((s) => s.theme);
  // The muscle views draw no vessels, so their toggle would do nothing there.
  const noVessels = useStore((s) => s.body.focus === "muscle" || (s.body.system === "muscles" && !s.body.process && !s.body.focus));
  return (
    <div className="controls" role="group" aria-label="How the figure is drawn">
      <button type="button" className="toggle" aria-pressed={layers.skin} onClick={() => setUi({ layers: { ...getState().layers, skin: !layers.skin } })}>
        Skin
      </button>
      <button type="button" className="toggle" aria-pressed={layers.vessels} disabled={noVessels} onClick={() => setUi({ layers: { ...getState().layers, vessels: !layers.vessels } })}>
        Vessels
      </button>
      <button type="button" className="toggle" aria-pressed={theme === "light"} onClick={() => setUi({ theme: theme === "dark" ? "light" : "dark" })}>
        Light
      </button>
    </div>
  );
}
