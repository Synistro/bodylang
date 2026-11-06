// The page can run as a live desktop wallpaper through Plash: http://localhost:5183/?wall
// A wallpaper runs all day on a large display, so it trades a little sharpness and smoothness
// for much less GPU work, and it reports its health to the dev server, since nobody is watching
// its console.
export const WALL = new URLSearchParams(location.search).has("wall");
export const WALL_FPS = 90;
export const WALL_PIXEL_RATIO = 1.5;

function report(event: Record<string, unknown>) {
  void fetch("/api/beacon", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);
}

export function startBeacon() {
  if (!import.meta.env.DEV) return;
  const where = WALL ? "wall" : "page";
  window.addEventListener("error", (e) => report({ where, error: e.message, at: `${e.filename}:${e.lineno}` }));
  window.addEventListener("unhandledrejection", (e) => report({ where, error: String(e.reason) }));
  let frames = 0;
  const tick = () => {
    frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const canvas = document.querySelector("canvas");
  const gl = canvas?.getContext("webgl2");
  report({
    where,
    readyAfterMs: Math.round(performance.now()),
    engine: navigator.userAgent.includes("Chrome") ? "chromium" : "webkit",
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    webgl2: Boolean(gl),
  });
  // Only the wallpaper needs a heartbeat, since nobody is watching its console.
  if (!WALL) return;
  window.setInterval(() => {
    report({
      where,
      rafPerSecond: Math.round(frames / 20),
      width: innerWidth,
      height: innerHeight,
      visible: document.visibilityState,
    });
    frames = 0;
  }, 20000);
}
