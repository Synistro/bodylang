// The cursor and the clock of a film: one unbroken take through real pointer events on the real page, aimed at the real
// buttons and at where each organ really is on screen, so a change in the layout moves the aim with it. The cursor is
// an element on the page. A scene writes its script with these, then calls finish.
window.__take = () => {
  const moduleUrl = (part) => {
    const url = performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => name.includes(part));
    if (!url) throw new Error(`The page hasn't loaded ${part}`);
    return url;
  };
  const { day, dinner } = window.__recordings;
  const names = {}; // the short name each question gets at the top of the page
  const app = () => window.bodylang;
  const stage = () => window.stage;

  // The network: each message gets what Claude really answered, and nothing else leaves the page.
  const encoder = new TextEncoder();
  let stream = null;
  let answering = null; // { left, speed, sentAt }
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, init) => {
    if (String(url).includes("/api/tell")) {
      const body = new ReadableStream({ start: (controller) => void (stream = controller) });
      return Promise.resolve(new Response(body, { status: 200 }));
    }
    if (String(url).includes("/api/name-question")) {
      const { text } = JSON.parse(init.body);
      return Promise.resolve(Response.json({ name: names[text] ?? null }));
    }
    return realFetch(url, init);
  };

  // The cursor.
  const pointer = document.createElement("div");
  pointer.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;z-index:100000;pointer-events:none;transform-origin:3px 2px;";
  pointer.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2 L3 18 L7.2 14.2 L10 20.4 L12.9 19.1 L10.1 13 L15.8 13 Z" fill="#fff" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  document.body.append(pointer);
  let x = innerWidth * 0.62;
  let y = innerHeight * 0.55;
  let pressed = false;
  let under = null;
  const place = () => {
    pointer.style.transform = `translate(${x - 3}px, ${y - 2}px) scale(${pressed ? 0.86 : 1})`;
  };
  const eventInit = (extra) => ({ bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: pressed ? 1 : 0, pointerId: 1, pointerType: "mouse", isPrimary: true, ...extra });
  const send = (element, type) => element.dispatchEvent(new PointerEvent(type, eventInit()));
  const sendMouse = (element, type) => element.dispatchEvent(new MouseEvent(type, eventInit()));
  const hover = () => {
    const element = document.elementFromPoint(x, y);
    if (element !== under) {
      if (under) { send(under, "pointerout"); sendMouse(under, "mouseout"); send(under, "pointerleave"); }
      if (element) { send(element, "pointerover"); sendMouse(element, "mouseover"); send(element, "pointerenter"); }
      under = element;
    }
    if (element) { send(element, "pointermove"); sendMouse(element, "mousemove"); }
  };

  // Where things are.
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight + 1 && getComputedStyle(element).visibility !== "hidden";
  };
  const centre = (element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  const leftOf = (element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left + Math.min(36, box.width / 2), y: box.top + box.height / 2 };
  };
  const find = (selector, text) => {
    const all = [...document.querySelectorAll(selector)].filter(visible);
    const found = text === undefined ? all[0] : all.find((element) => element.innerText.trim().startsWith(text));
    if (!found) throw new Error(`Nothing on screen matches ${selector} "${text ?? ""}"`);
    return found;
  };
  const system = (title) => () => leftOf(find(".tree-title", title));
  const leaf = (title) => () => leftOf(find(".tree-leaf-title", title));
  const button = (text) => () => centre(find("button", text));
  const labelled = (label) => () => centre(find(`button[aria-label="${label}"]`));
  const stop = (number) => () => centre(find(`button[aria-label^="Stop ${number},"]`));
  const replyLine = (text) => () => leftOf(find("button.reply-line", text));
  const box = () => centre(find("form.composer textarea"));
  const plot = (share) => () => {
    const area = find(".day-plot canvas").getBoundingClientRect();
    return { x: area.left + area.width * share, y: area.top + area.height * 0.5 };
  };
  const onBody = (fractionX, fractionY) => () => ({ x: innerWidth * fractionX, y: innerHeight * fractionY });
  // Starts where the app says the part is, and looks outward for the nearest point a click there really lands on it.
  const part = (id, key, anchor = id) => () => {
    const home = stage().project(stage().anchorOf(anchor));
    for (let radius = 0; radius < 160; radius += 6) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
        const point = { x: home.x + Math.cos(angle) * radius, y: home.y + Math.sin(angle) * radius };
        if (stage().pickTarget(point.x, point.y)[key] === id) return point;
        if (radius === 0) break;
      }
    }
    throw new Error(`No point on screen near ${id} picks it`);
  };
  const organ = (id) => part(id, "organ");
  const muscle = (id) => part(id, "muscle", `muscle:${id}`);

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  // The script: each step lasts a fixed time, so the film's length is known before it starts.
  const steps = [];
  const captions = [];
  const cues = []; // where each part of the music's arrangement starts
  const cue = (level) => cues.push({ at: duration(), level });
  const duration = () => steps.reduce((sum, step) => sum + step.seconds, 0);
  // A line under the picture from now, and where the film looks until the next one.
  const say = (text, shown = 3.5, look = "whole") => captions.push({ at: duration(), text, shown, look });
  const cards = [];
  let score = "headnod";
  // Words on a black screen from now, for this long. The page keeps running behind it, so steps can happen unseen.
  const card = (text, small, seconds) => cards.push({ start: duration(), end: duration() + seconds, text, small });
  const waitUntil = (at) => wait(Math.max(0, at - duration()));
  const useScore = (name) => {
    score = name;
  };
  const wait = (seconds) => steps.push({ seconds, name: `wait ${seconds}` });
  const moveTo = (target, seconds = 0.55) => {
    let from;
    let to;
    steps.push({
      seconds,
      name: "move",
      begin: () => { from = { x, y }; to = target(); },
      during: (progress) => {
        // Aims again on the way in, because the camera may still be flying.
        if (progress > 0.5) to = target();
        const eased = ease(progress);
        x = from.x + (to.x - from.x) * eased;
        y = from.y + (to.y - from.y) * eased;
      },
    });
  };
  const press = () => {
    pressed = true;
    place();
    const element = document.elementFromPoint(x, y);
    send(element, "pointerdown");
    sendMouse(element, "mousedown");
    return element;
  };
  const release = (element) => {
    pressed = false;
    send(element, "pointerup");
    sendMouse(element, "mouseup");
  };
  const clickHere = () => {
    let element;
    steps.push({ seconds: 0.09, name: "press", begin: () => { element = press(); } });
    steps.push({
      seconds: 0.03,
      name: "release",
      begin: () => {
        release(element);
        element.dispatchEvent(new MouseEvent("click", eventInit()));
      },
    });
  };
  const click = (target, then = 0.4, seconds) => {
    moveTo(target, seconds);
    wait(0.12);
    clickHere();
    wait(then);
  };
  const drag = (path, seconds) => {
    let element;
    let from;
    let points;
    steps.push({
      seconds,
      name: "drag",
      begin: () => {
        from = { x, y };
        points = path.map((point) => point());
        element = press();
      },
      during: (progress) => {
        const stops = [from, ...points];
        const place = Math.min(stops.length - 1.0001, progress * (stops.length - 1));
        const at = Math.floor(place);
        const local = ease(place - at);
        x = stops[at].x + (stops[at + 1].x - stops[at].x) * local;
        y = stops[at].y + (stops[at + 1].y - stops[at].y) * local;
        send(element, "pointermove");
        sendMouse(element, "mousemove");
      },
      end: () => release(element),
    });
  };
  const write = (text) => {
    const box = () => document.querySelector("form.composer textarea");
    const set = (value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box(), value);
      box().dispatchEvent(new Event("input", { bubbles: true }));
    };
    steps.push({ seconds: text.length / 26, name: "type", during: (progress) => set(text.slice(0, Math.ceil(progress * text.length))), end: () => set(text) });
  };
  // Sends what is in the box, and plays back what Claude really answered, faster than it took.
  const sendSentence = (recording, speed) => {
    steps.push({
      seconds: 0.2,
      name: "send",
      begin: () => {
        answering = { left: [...recording.events], speed, sentAt: performance.now() };
        document.querySelector("form.composer textarea").closest("form").requestSubmit();
      },
    });
  };
  const answerTime = (recording, speed, type = "reply") =>
    recording.events.find(({ event }) => event.type === type).ms / 1000 / speed + 0.5;

  // Runs once the script is written: sets the film's length and what it saves, then the day it starts from.
  const finish = () => {
    const length = duration();
    window.__length = length;
    const shots = [];
    captions.forEach((caption, index) => {
      const end = captions[index + 1]?.at ?? length;
      const captionEnd = Math.min(end, caption.at + caption.shown);
      shots.push({ start: caption.at, end: captionEnd, caption: caption.text, look: caption.look });
      if (captionEnd < end) shots.push({ start: captionEnd, end, caption: null, look: caption.look });
    });
    window.__film = { seconds: length, shots, cues, cards, score };

    let index = -1;
    let endsAt = 0;
    window.__timeline = (frame, seconds) => {
      while (index + 1 < steps.length && seconds >= endsAt) {
        steps[index]?.during?.(1);
        steps[index]?.end?.();
        index += 1;
        // From the script's own clock, so short steps can't add up to a drift.
        steps[index].startedAt = endsAt;
        endsAt += steps[index].seconds;
        steps[index].begin?.();
      }
      const step = steps[index];
      if (step) step.during?.(Math.min(1, (seconds - step.startedAt) / step.seconds));
      if (answering && stream) {
        const since = performance.now() - answering.sentAt;
        while (answering && answering.left.length && since >= 400 + answering.left[0].ms / answering.speed) {
          const { event } = answering.left.shift();
          stream.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === "done") {
            stream.close();
            stream = null;
            answering = null;
          }
        }
      }
      place();
      if (!pressed) hover();
    };

    import(moduleUrl("/src/actions/schemas.ts")).then(async ({ ACTION_SCHEMAS }) => {
      const act = (name, args) => app().dispatch({ name, args });
      for (const id of ["coffee", "sugar_bar", "pizza"]) act("remove_intake", { id });
      act("set_now", { at: day.now });
      for (const { event } of day.events)
        if (event.type === "action" && event.name !== "show_system") app().dispatch({ name: event.name, args: ACTION_SCHEMAS[event.name].parse(event.args) });
      for (const { event } of startsWith)
        if (event.type === "action" && event.name !== "show_system") app().dispatch({ name: event.name, args: ACTION_SCHEMAS[event.name].parse(event.args) });
      act("set_now", { at: dinner.now });
      act("focus_organ", { organ: null });
      act("show_system", { system: "overview" });
      // The browser keeps a theme between films.
      app().setUi({ exchanges: [], t: dinner.now, mode: "tell", theme: "dark" });
      // Lets the camera and the panels settle on this day before the first frame.
      await window.__settle(120);
      place();
      window.__ready = true;
    });
  };

  const startsWith = [];
  return {
    answerTime,
    card,
    duration,
    useScore,
    waitUntil,
    box,
    button,
    clickHere,
    click,
    cue,
    drag,
    finish,
    find,
    labelled,
    leaf,
    moveTo,
    muscle,
    names,
    onBody,
    organ,
    plot,
    replyLine,
    say,
    sendSentence,
    startsWith,
    stop,
    system,
    wait,
    write,
    centre,
  };
};
