import { SYSTEM_HUE } from "../src/look";
import type { EmbedMessage, Example } from "../src/wire";
import day from "../demo/walkthrough/day.json";
import dinner from "../demo/walkthrough/dinner.json";
import blood from "../demo/landing/recordings/blood.json";
import bullet from "../demo/landing/recordings/bullet.json";
import butterflies from "../demo/landing/recordings/butterflies.json";
import cannabis from "../demo/landing/recordings/cannabis.json";
import covid from "../demo/landing/recordings/covid.json";
import period from "../demo/landing/recordings/period.json";
import "../src/ui/tokens.css";
import "./site.css";
import { setUpFilm, setUpPhoneFilms } from "./film";

// The recorded day the README's films use, and Deep answers recorded for this page with
// `node demo/record.mjs landing`. The app checks every action and event itself.
const EXAMPLES = [covid, bullet, blood, cannabis, butterflies, period] as Example[];

document.documentElement.style.setProperty("--accent", SYSTEM_HUE.digestion.dark);

const frame = document.querySelector("iframe")!;

const actions = (recording: { events: { event: unknown }[] }) =>
  recording.events.flatMap(({ event }) => {
    const { type, name, args } = event as { type: string; name?: string; args?: unknown };
    return type === "action" && name && name !== "show_system" ? [{ name, args }] : [];
  });

const film = setUpFilm(() => frame.focus());

window.addEventListener("message", (e: MessageEvent) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  if (e.data?.type === "bodylang:film") return film.open();
  if (e.data?.type !== "bodylang:ready") return;
  const show: EmbedMessage = {
    type: "bodylang:show",
    now: dinner.now,
    actions: [...actions(day), ...actions(dinner)],
    examples: EXAMPLES,
  };
  frame.contentWindow!.postMessage(show, location.origin);
});

// In development the app is the dev server's own page. Built, it sits in app/ beside this page. A narrow screen
// shows a still image in its place and never loads the app, its meshes or its 3D scene.
const wide = matchMedia("(min-width: 861px)");
const start = () => {
  if (!wide.matches || frame.src) return;
  frame.src = import.meta.env.DEV ? "/?embed" : "app/?embed";
  film.openFirstTime();
};
wide.addEventListener("change", start);
start();
setUpPhoneFilms();
