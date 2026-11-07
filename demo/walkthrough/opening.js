// The film's first seconds: the whole recorded day passing in a time-lapse, moving through what each part of the day
// is doing, so it opens on a whole body rather than one meal.
(() => {
  const moduleUrl = (part) => performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => name.includes(part));
  const { day, dinner } = window.__recordings;
  const app = () => window.bodylang;
  const act = (name, args) => app().dispatch({ name, args });
    const TO = dinner.now;
  const RUNS_FOR = 6;
  const HOLDS_FOR = 1.4;
  window.__length = RUNS_FOR + HOLDS_FOR;

  const clockOf = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const atOf = (id) => [...day.events, ...dinner.events].map(({ event }) => event).find((event) => event.args?.id === id).args;
  const moments = [
    { at: atOf("coffee").at, text: "Coffee and oatmeal" },
    { at: atOf("chicken").at, text: "Chicken and rice" },
    { at: atOf("leg_day").from, text: "A heavy leg day" },
    { at: atOf("pizza").at, text: "Pizza and beer" },
  ];
  // Each moment gets the same time on screen, so the clock runs faster through the long gaps.
  const EACH = RUNS_FOR / moments.length;
  const stops = [...moments.map((moment) => moment.at), TO];
  const clockAt = (seconds) => {
    const index = Math.min(moments.length - 1, Math.floor(seconds / EACH));
    const within = Math.min(1, seconds / EACH - index);
    return stops[index] + (stops[index + 1] - stops[index]) * within;
  };
  const shots = moments.map((moment, index) => ({
    start: index * EACH,
    end: (index + 1) * EACH,
    caption: `${clockOf(moment.at)}  ${moment.text}`,
    look: "whole",
  }));
  shots.push({ start: RUNS_FOR, end: window.__length, caption: "Your whole body, through the whole day.", look: "whole" });
  window.__film = { seconds: window.__length, shots };

  const system = (id) => () => {
    act("focus_organ", { organ: null });
    act("show_process", { id: null });
    act("show_system", { system: id });
  };
  const organ = (id, muscle) => () => {
    act("show_process", { id: null });
    act("focus_organ", muscle ? { organ: id, muscle } : { organ: id });
  };
  const VIEWS = [
    { from: 0, go: organ("brain") },
    { from: EACH, go: system("energy") },
    { from: EACH * 2, go: organ("muscle", "quads") },
    { from: EACH * 3, go: organ("stomach") },
    { from: RUNS_FOR, go: system("overview") },
  ];

  let shown = -1;
  window.__timeline = (frame, seconds) => {
    app().setUi({ t: clockAt(seconds) });
    const next = VIEWS.findLastIndex((view) => seconds >= view.from);
    if (next !== shown) {
      shown = next;
      VIEWS[next].go();
    }
  };

  import(moduleUrl("/src/actions/schemas.ts")).then(async ({ ACTION_SCHEMAS }) => {
    for (const id of ["coffee", "sugar_bar", "pizza"]) act("remove_intake", { id });
    for (const { event } of [...day.events, ...dinner.events])
      if (event.type === "action" && event.name !== "show_system")
        app().dispatch({ name: event.name, args: ACTION_SCHEMAS[event.name].parse(event.args) });
    act("set_now", { at: TO });
    app().setUi({ exchanges: [], t: stops[0], mode: "tell", theme: "dark" });
    VIEWS[0].go();
    shown = 0;
    // Lets the camera arrive before the first frame, which is also the video's thumbnail.
    await window.__settle(120);
    window.__ready = true;
  });
})()
