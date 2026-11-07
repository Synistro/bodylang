// The Ask film's first seconds: words on black, then very different questions, each held on a real moment of its real
// answer for long enough to take in, to show that this works for anything.
(() => {
  const recordings = window.__recordings;
  const moduleUrl = (part) => performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => name.includes(part));
  const app = () => window.bodylang;
  const act = (name, args) => app().dispatch({ name, args });
  const CARD_SECONDS = 4.5;
  const CLIP_SECONDS = 3.2;
  const CLIPS = [
    ["bullet", 0],
    ["blood", 1],
    ["cannabis", 1],
    ["sex", 0],
    ["butterflies", 2],
    ["period", 1],
  ];
  const clips = CLIPS.map(([id, step]) => ({ recording: recordings[id], step }));
  window.__length = CARD_SECONDS + clips.length * CLIP_SECONDS;
  window.__film = {
    seconds: window.__length,
    shots: [
      { start: 0, end: CARD_SECONDS, caption: null, look: "whole" },
      ...clips.map(({ recording }, index) => ({
        start: CARD_SECONDS + index * CLIP_SECONDS,
        end: CARD_SECONDS + (index + 1) * CLIP_SECONDS,
        caption: recording.text,
        look: "whole",
      })),
    ],
    cards: [{ start: 0, end: CARD_SECONDS, text: "Ask it anything.", small: "Whatever can happen to a body, you can watch it happen." }],
  };

  let store = null;
  let schemas = null;
  const stopFor = (event) => ["guide", "show_system", "focus_organ", "show_process"].includes(event.name);
  const open = async ({ recording, step }) => {
    store.leaveAsk();
    store.enterAsk();
    if (recording.body) store.setBody(recording.body);
    for (const { event } of recording.events)
      if (event.type === "action" && !stopFor(event)) app().dispatch({ name: event.name, args: schemas[event.name].parse(event.args) });
    const guide = recording.events.find(({ event }) => event.name === "guide").event;
    app().dispatch({ name: "guide", args: schemas.guide.parse(guide.args) });
    store.goToStep(step);
    // The camera has arrived before the clip's first frame, because a clip is too short to watch it fly.
    await window.__settle(70);
  };
  const scene = (work) => {
    window.__busy = true;
    work().then(() => {
      window.__busy = false;
    });
  };

  let shown = -1;
  window.__timeline = (frame, seconds) => {
    // The first clip is already in place behind the black screen, so it is whole when the screen lifts.
    const index = Math.max(0, Math.floor((seconds - CARD_SECONDS) / CLIP_SECONDS));
    if (index === shown || index >= clips.length) return;
    shown = index;
    scene(() => open(clips[index]));
  };

  Promise.all([import(moduleUrl("/src/actions/schemas.ts")), import(moduleUrl("/src/store.ts"))]).then(async ([{ ACTION_SCHEMAS }, loaded]) => {
    schemas = ACTION_SCHEMAS;
    store = loaded;
    for (const id of ["coffee", "sugar_bar", "pizza"]) act("remove_intake", { id });
    for (const { event } of [...recordings.day.events, ...recordings.dinner.events])
      if (event.type === "action" && event.name !== "show_system") app().dispatch({ name: event.name, args: schemas[event.name].parse(event.args) });
    act("set_now", { at: recordings.dinner.now });
    app().setUi({ exchanges: [], t: recordings.dinner.now, mode: "ask", depth: "simple", theme: "dark" });
    window.__ready = true;
  });
})()
