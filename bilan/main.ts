import type { Labs, Sex } from "../src/model/scenario";
import {
  BREAKFASTS,
  type BreakfastId,
  BREAKFAST_AT,
  clock,
  compare,
  FROM_MIN,
  homaOf,
  PRESETS,
  RANGE_MMOL,
  type Run,
  TO_MIN,
} from "./compare";

const SVG = "http://www.w3.org/2000/svg";
const num = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const fmt = (n: number) => num.format(n);

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Il manque l'élément #${id} dans la page.`);
  return el as T;
};

function el(tag: string, props: Record<string, unknown> = {}, text?: string) {
  const node = Object.assign(document.createElement(tag), props);
  if (text !== undefined) node.textContent = text;
  return node;
}

function input(props: Record<string, unknown>) {
  return Object.assign(document.createElement("input"), props);
}

function select() {
  return document.createElement("select");
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

type LabKey = keyof Labs;
const LAB_FIELDS: { key: LabKey; label: string; step: string }[] = [
  { key: "fastingGlucoseMmol", label: "Glycémie à jeun (mmol/L)", step: "0.1" },
  { key: "fastingInsulinUuMl", label: "Insuline à jeun (µUI/mL)", step: "0.5" },
  { key: "triglyceridesMmol", label: "Triglycérides (mmol/L)", step: "0.1" },
  { key: "hba1cPct", label: "HbA1c (%)", step: "0.1" },
  { key: "ldlMmol", label: "LDL (mmol/L)", step: "0.1" },
  { key: "hdlMmol", label: "HDL (mmol/L)", step: "0.1" },
];

const labInputs = new Map<LabKey, HTMLInputElement>();
for (const f of LAB_FIELDS) {
  const field = input({ type: "number", step: f.step, min: "0", inputMode: "decimal" });
  labInputs.set(f.key, field);
  $("labs").append(el("label", {}, f.label));
  $("labs").lastElementChild?.append(field);
}

const bodyInputs = {
  sex: select(),
  age: input({ type: "number", min: "18", max: "90", step: "1", value: "30" }),
  heightCm: input({ type: "number", min: "140", max: "220", step: "1", value: "180" }),
  weightKg: input({ type: "number", min: "40", max: "200", step: "1", value: "80" }),
};
bodyInputs.sex.append(el("option", { value: "male" }, "Homme"), el("option", { value: "female" }, "Femme"));
for (const [text, input] of [
  ["Sexe", bodyInputs.sex],
  ["Âge (ans)", bodyInputs.age],
  ["Taille (cm)", bodyInputs.heightCm],
  ["Poids (kg)", bodyInputs.weightKg],
] as const) {
  const label = el("label", {}, text);
  label.append(input);
  $("body").append(label);
}

const breakfastSelect = $<HTMLSelectElement>("breakfast");
for (const b of BREAKFASTS) breakfastSelect.append(el("option", { value: b.id }, b.label));
const coffeeBox = $<HTMLInputElement>("coffee");

function setLabs(labs: Required<Labs>) {
  for (const [key, input] of labInputs) input.value = String(labs[key]);
  render();
}
$("preset-typique").addEventListener("click", () => setLabs(PRESETS.typique));
$("preset-surveiller").addEventListener("click", () => setLabs(PRESETS.surveiller));

function readLabs(): Labs {
  const labs: Labs = {};
  for (const [key, input] of labInputs) {
    const v = Number.parseFloat(input.value);
    if (Number.isFinite(v) && v > 0) labs[key] = v;
  }
  return labs;
}

// What the usual ranges are for the markers the model only shows. Printed ranges differ between labs.
const MARKERS: { key: LabKey; name: string; unit: string; usual: string; within: (v: number, sex: Sex) => boolean }[] =
  [
    { key: "hba1cPct", name: "HbA1c", unit: "%", usual: "moins de 5,7 %", within: (v) => v < 5.7 },
    { key: "ldlMmol", name: "LDL", unit: "mmol/L", usual: "moins de 3,4 mmol/L", within: (v) => v < 3.4 },
    {
      key: "hdlMmol",
      name: "HDL",
      unit: "mmol/L",
      usual: "au moins 1,0 mmol/L chez l'homme, 1,3 chez la femme",
      within: (v, sex) => v >= (sex === "male" ? 1.0 : 1.3),
    },
  ];

const COLORS = {
  you: "#4385be",
  typical: "#a19e97",
  ink: "#d0cec6",
  ink3: "#8a8782",
  faint: "#595652",
  band: "rgba(208,206,198,0.16)",
};
const M = { l: 44, r: 16, t: 20, b: 30 };

interface Plot {
  x: (t: number) => number;
  y: (v: number) => number;
  yMax: number;
}

// The chart is drawn at the width it is shown, so its text keeps a readable size on a phone.
function drawChart(typical: Run, yours: Run) {
  const W = Math.max(300, Math.min(720, Math.round($("plot").clientWidth || 720)));
  const H = W < 500 ? 280 : 340;
  const yMax = Math.max(10, Math.ceil(Math.max(...[typical, yours].flatMap((r) => [r.breakfastPeak.mmol])) + 1.5), 12);
  const plot: Plot = {
    x: (t) => M.l + ((t - FROM_MIN) / (TO_MIN - FROM_MIN)) * (W - M.l - M.r),
    y: (v) => H - M.b - ((v - 3) / (yMax - 3)) * (H - M.t - M.b),
    yMax,
  };
  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Glycémie en mmol/L de 06:00 à minuit, corps typique et corps selon ce bilan",
  });
  root.append(
    svg("rect", {
      x: plot.x(FROM_MIN),
      y: plot.y(RANGE_MMOL.high),
      width: plot.x(TO_MIN) - plot.x(FROM_MIN),
      height: plot.y(RANGE_MMOL.low) - plot.y(RANGE_MMOL.high),
      fill: COLORS.band,
    }),
  );
  for (let v = 4; v <= yMax; v += 2) {
    root.append(svg("line", { x1: M.l, x2: W - M.r, y1: plot.y(v), y2: plot.y(v), stroke: "rgba(208,206,198,0.09)" }));
    root.append(
      svg(
        "text",
        { x: M.l - 8, y: plot.y(v) + 4, "text-anchor": "end", fill: COLORS.ink3, "font-size": 12 },
        String(v),
      ),
    );
  }
  for (let h = 6; h <= 24; h += 3) {
    root.append(
      svg(
        "text",
        { x: plot.x(h * 60), y: H - 8, "text-anchor": h === 24 ? "end" : "middle", fill: COLORS.ink3, "font-size": 12 },
        `${String(h % 24).padStart(2, "0")}h`,
      ),
    );
  }
  const meals = [
    [BREAKFAST_AT, "petit-déj"],
    [12 * 60 + 30, "déjeuner"],
    [19 * 60 + 30, "dîner"],
  ] as const;
  for (const [t, name] of meals) {
    root.append(
      svg("line", {
        x1: plot.x(t),
        x2: plot.x(t),
        y1: M.t,
        y2: H - M.b,
        stroke: COLORS.faint,
        "stroke-dasharray": "2 4",
      }),
    );
    root.append(svg("text", { x: plot.x(t) + 4, y: M.t - 6, fill: COLORS.ink3, "font-size": 11 }, name));
  }
  const path = (run: Run) => {
    let d = "";
    for (let t = FROM_MIN; t <= TO_MIN; t += 2)
      d += `${d ? "L" : "M"}${plot.x(t).toFixed(1)},${plot.y(run.glucoseMmol[t]).toFixed(1)}`;
    return d;
  };
  root.append(
    svg("path", {
      d: path(typical),
      fill: "none",
      stroke: COLORS.typical,
      "stroke-width": 2,
      "stroke-dasharray": "5 4",
      "stroke-linejoin": "round",
    }),
  );
  root.append(
    svg("path", { d: path(yours), fill: "none", stroke: COLORS.you, "stroke-width": 2.5, "stroke-linejoin": "round" }),
  );

  const hair = svg("line", { y1: M.t, y2: H - M.b, stroke: COLORS.ink3, visibility: "hidden" });
  const dotTypical = svg("circle", {
    r: 4,
    fill: COLORS.typical,
    stroke: "#110f0e",
    "stroke-width": 2,
    visibility: "hidden",
  });
  const dotYours = svg("circle", {
    r: 4,
    fill: COLORS.you,
    stroke: "#110f0e",
    "stroke-width": 2,
    visibility: "hidden",
  });
  const hit = svg("rect", { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, fill: "transparent" });
  root.append(hair, dotTypical, dotYours, hit);

  const tip = el("div", { className: "tip", hidden: true });
  const show = (clientX: number) => {
    const box = root.getBoundingClientRect();
    const ratio = (clientX - box.left) / box.width;
    const t = Math.round(FROM_MIN + ((ratio * W - M.l) / (W - M.l - M.r)) * (TO_MIN - FROM_MIN));
    const minute = Math.max(FROM_MIN, Math.min(TO_MIN, t));
    const a = typical.glucoseMmol[minute];
    const b = yours.glucoseMmol[minute];
    hair.setAttribute("x1", String(plot.x(minute)));
    hair.setAttribute("x2", String(plot.x(minute)));
    dotTypical.setAttribute("cx", String(plot.x(minute)));
    dotTypical.setAttribute("cy", String(plot.y(a)));
    dotYours.setAttribute("cx", String(plot.x(minute)));
    dotYours.setAttribute("cy", String(plot.y(b)));
    for (const n of [hair, dotTypical, dotYours]) n.setAttribute("visibility", "visible");
    tip.replaceChildren(
      el("strong", {}, `${clock(minute)}`),
      el("div", {}, `Selon ton bilan : ${fmt(b)}`),
      el("div", {}, `Corps typique : ${fmt(a)}`),
    );
    tip.hidden = false;
    const left = (plot.x(minute) / W) * box.width;
    tip.style.left = `${Math.min(left + 12, box.width - 170)}px`;
    tip.style.top = "0px";
  };
  const hide = () => {
    for (const n of [hair, dotTypical, dotYours]) n.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };
  hit.addEventListener("pointermove", (e) => show(e.clientX));
  hit.addEventListener("pointerleave", hide);
  $("plot").replaceChildren(root, tip);
}

function drawLegend() {
  const item = (cls: string, color: string, text: string) => {
    const wrap = el("span");
    wrap.append(el("i", { className: cls }), text);
    (wrap.firstElementChild as HTMLElement).style.borderColor = color;
    if (cls === "band") (wrap.firstElementChild as HTMLElement).style.background = COLORS.band;
    return wrap;
  };
  $("legend").replaceChildren(
    item("", COLORS.you, "Ton corps selon ce bilan"),
    item("dash", COLORS.typical, "Corps typique (même corps, sans bilan)"),
    item("band", COLORS.band, "Plage usuelle 3,9 à 7,8"),
  );
}

function drawTable(typical: Run, yours: Run) {
  const head = el("tr");
  for (const h of ["Heure", "Selon ton bilan", "Corps typique"]) head.append(el("th", {}, h));
  const rows = [head];
  for (let t = FROM_MIN; t <= TO_MIN; t += 60) {
    const row = el("tr");
    row.append(
      el("td", {}, clock(t)),
      el("td", {}, fmt(yours.glucoseMmol[t])),
      el("td", {}, fmt(typical.glucoseMmol[t])),
    );
    rows.push(row);
  }
  $("table").replaceChildren(...rows);
}

const read = (big: string, what: string) => {
  const box = el("div", { className: "read" });
  box.append(el("div", { className: "big" }, big), el("div", { className: "what" }, what));
  return box;
};

const minutesText = (m: number) =>
  m === 0 ? "aucune minute" : m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;

function drawReads(typical: Run, yours: Run) {
  const reads = [
    read(
      `${fmt(yours.breakfastPeak.mmol)} mmol/L à ${clock(yours.breakfastPeak.at)}`,
      `Pic après le petit-déjeuner. Corps typique : ${fmt(typical.breakfastPeak.mmol)} mmol/L à ${clock(typical.breakfastPeak.at)}.`,
    ),
    read(
      minutesText(yours.minutesAbove),
      `Temps passé au-dessus de 7,8 mmol/L dans la journée. Corps typique : ${minutesText(typical.minutesAbove)}.`,
    ),
    read(
      yours.backNearFastingAt === null ? "Pas avant le déjeuner" : `Vers ${clock(yours.backNearFastingAt)}`,
      `Retour près du niveau à jeun après le petit-déjeuner. Corps typique : ${typical.backNearFastingAt === null ? "pas avant le déjeuner" : `vers ${clock(typical.backNearFastingAt)}`}.`,
    ),
  ];
  if (typical.insulinPeak > 0) {
    const ratio = yours.insulinPeak / typical.insulinPeak;
    reads.push(
      read(
        `×${fmt(ratio)}`,
        `Pic d'insuline après le petit-déjeuner, comparé au corps typique (${fmt(yours.insulinPeak)} contre ${fmt(typical.insulinPeak)} µUI/mL).`,
      ),
    );
  }
  $("reads").replaceChildren(...reads);
}

function drawMarkers(labs: Labs, sex: Sex) {
  const lines = MARKERS.flatMap((m) => {
    const v = labs[m.key];
    if (v === undefined) return [];
    const where = m.within(v, sex) ? "dans la plage usuelle" : "hors de la plage usuelle";
    return [
      el("p", {}, `${m.name} ${fmt(v)} ${m.unit} : ${where} (${m.usual}). Affiché ici, sans effet sur la simulation.`),
    ];
  });
  $("markers").replaceChildren(...lines);
}

function render() {
  const sex = bodyInputs.sex.value as Sex;
  const body = {
    sex,
    age: Number.parseFloat(bodyInputs.age.value) || 30,
    heightCm: Number.parseFloat(bodyInputs.heightCm.value) || 180,
    weightKg: Number.parseFloat(bodyInputs.weightKg.value) || 80,
  };
  const labs = readLabs();
  const { typical, yours } = compare({
    body: { ...body, labs },
    breakfast: breakfastSelect.value as BreakfastId,
    coffee: coffeeBox.checked,
  });
  const homa = homaOf(labs);
  const sens = yours.trajectory.anthro.sensitivity / typical.trajectory.anthro.sensitivity;
  $("homa").textContent =
    homa === null
      ? "Avec la glycémie et l'insuline à jeun, le modèle estime ta sensibilité à l'insuline."
      : `Indice HOMA-IR calculé : ${fmt(homa)}. Le modèle en tire une sensibilité à l'insuline de ×${fmt(sens)} par rapport au corps typique.`;
  drawLegend();
  drawChart(typical, yours);
  drawTable(typical, yours);
  drawReads(typical, yours);
  drawMarkers(labs, sex);
}

for (const input of [...labInputs.values(), ...Object.values(bodyInputs), breakfastSelect, coffeeBox]) {
  input.addEventListener("input", render);
}
window.addEventListener("resize", render);
setLabs(PRESETS.surveiller);
