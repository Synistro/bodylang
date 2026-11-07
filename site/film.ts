// The film that opens the landing page on a first visit, over the demo it introduces. It waits on its first frame
// with two choices, play it or go to the demo, and plays with sound once someone starts it. Closing it leaves the
// visitor in the demo, and the demo's own "Watch the film" link opens it again.

const SEEN = "bodylang:film-seen";
const IDLE_MS = 2200;
const SEEK_S = 5;
const VOLUME = 0.5;

const FILMS = {
  app: { src: "films/bodylang.mp4", poster: "films/bodylang.jpg" },
  ask: { src: "films/ask.mp4", poster: "films/ask.jpg" },
};
type FilmId = keyof typeof FILMS;

// Browser storage can be missing or refuse access, as in a private window. Then the film opens on every visit.
function seen() {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {}
}

const clock = (s: number) => {
  const whole = Math.max(0, Math.floor(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

export function setUpFilm(onClosed: () => void) {
  const dialog = document.querySelector<HTMLDialogElement>("dialog.film")!;
  const video = dialog.querySelector("video")!;
  const stage = dialog.querySelector<HTMLElement>(".film-stage")!;
  const playButton = dialog.querySelector<HTMLButtonElement>(".film-play")!;
  const startButton = dialog.querySelector<HTMLButtonElement>(".film-start-play")!;
  const soundButton = dialog.querySelector<HTMLButtonElement>(".film-sound")!;
  const track = dialog.querySelector<HTMLElement>(".film-track")!;
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>(".film-tab")];
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  let idle = 0;
  const wake = () => {
    stage.dataset.awake = "";
    window.clearTimeout(idle);
    idle = window.setTimeout(() => {
      if (!video.paused) delete stage.dataset.awake;
    }, IDLE_MS);
  };

  const showTime = () => {
    const share = video.duration ? video.currentTime / video.duration : 0;
    track.style.setProperty("--played", String(share));
    track.setAttribute("aria-valuenow", String(Math.round(share * 100)));
    track.setAttribute("aria-valuetext", `${clock(video.currentTime)} of ${clock(video.duration || 0)}`);
  };
  const showPlaying = () => {
    if (!video.paused) dialog.dataset.started = "";
    stage.dataset.playing = video.paused ? "false" : "true";
    playButton.setAttribute("aria-label", video.paused ? "Play" : "Pause");
    if (video.paused) stage.dataset.awake = "";
    else wake();
  };
  const showSound = () => {
    stage.dataset.muted = String(video.muted);
    soundButton.setAttribute("aria-label", video.muted ? "Turn sound on" : "Turn sound off");
  };

  const toggle = () => (video.paused ? void video.play() : video.pause());
  const seekTo = (share: number) => {
    if (video.duration) video.currentTime = Math.min(1, Math.max(0, share)) * video.duration;
  };

  const choose = (id: FilmId, play: boolean) => {
    for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.film === id));
    video.poster = FILMS[id].poster;
    video.src = FILMS[id].src;
    showTime();
    if (play) void video.play();
  };

  video.addEventListener("play", showPlaying);
  video.addEventListener("pause", showPlaying);
  video.addEventListener("ended", showPlaying);
  video.addEventListener("timeupdate", showTime);
  video.addEventListener("loadedmetadata", showTime);
  video.addEventListener("volumechange", showSound);
  video.addEventListener("click", toggle);
  playButton.addEventListener("click", toggle);
  startButton.addEventListener("click", toggle);
  soundButton.addEventListener("click", () => {
    video.muted = !video.muted;
  });
  stage.addEventListener("pointermove", wake);
  for (const tab of tabs) tab.addEventListener("click", () => choose(tab.dataset.film as FilmId, true));

  // Dragging along the bar scrubs, and the arrow keys step through it when it has focus.
  track.addEventListener("pointerdown", (e) => {
    track.setPointerCapture(e.pointerId);
    const at = (event: PointerEvent) => {
      const box = track.getBoundingClientRect();
      seekTo((event.clientX - box.left) / box.width);
    };
    at(e);
    track.addEventListener("pointermove", at);
    track.addEventListener("pointerup", () => track.removeEventListener("pointermove", at), { once: true });
  });

  dialog.addEventListener("keydown", (e) => {
    // Space plays and pauses wherever focus is, except on the buttons that leave.
    if (e.target instanceof HTMLElement && e.target.closest("[data-close]") && (e.key === " " || e.key === "Enter")) return;
    const step = { ArrowLeft: -SEEK_S, ArrowRight: SEEK_S }[e.key];
    if (e.key === " " || e.key === "k") toggle();
    else if (e.key === "m") video.muted = !video.muted;
    else if (step !== undefined) video.currentTime = Math.max(0, video.currentTime + step);
    else return;
    e.preventDefault();
    wake();
  });

  const close = () => {
    if (!dialog.open || dialog.dataset.closing !== undefined) return;
    markSeen();
    video.pause();
    dialog.dataset.closing = "";
    const done = () => {
      delete dialog.dataset.closing;
      dialog.close();
      onClosed();
    };
    if (still.matches) done();
    else dialog.addEventListener("animationend", done, { once: true });
  };
  // Escape and the close button both leave through the same short fade.
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  for (const button of dialog.querySelectorAll("[data-close]")) button.addEventListener("click", close);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });

  const open = (id: FilmId = "app") => {
    if (dialog.open) return;
    // The film never starts by itself, so the click that starts it lets it play with sound.
    video.muted = false;
    video.volume = VOLUME;
    showSound();
    delete dialog.dataset.started;
    dialog.showModal();
    choose(id, false);
    showPlaying();
  };

  const forced = new URLSearchParams(location.search).has("film");
  return { open, openFirstTime: () => (forced || !seen() ? open() : undefined) };
}

// Phones get the films in place of the 3D app: a switch between the two, and the first frame with a play button that
// opens the phone's own player, with its controls, AirPlay and picture in picture.
export function setUpPhoneFilms() {
  const section = document.querySelector<HTMLElement>(".phone-film")!;
  const video = section.querySelector("video")!;
  const play = section.querySelector<HTMLButtonElement>(".phone-play")!;
  const tabs = [...section.querySelectorAll<HTMLButtonElement>(".film-tab")];

  // Play opens the phone's own full-screen player, which turns with the phone. An iPhone has only its own call for
  // that, and other phones take the standard one.
  const fullScreen = () => {
    const iphone = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    if (video.requestFullscreen) void video.requestFullscreen();
    else iphone.webkitEnterFullscreen?.();
  };
  const start = () => {
    section.dataset.started = "";
    video.controls = true;
    void video.play();
    fullScreen();
  };
  play.addEventListener("click", start);
  for (const tab of tabs)
    tab.addEventListener("click", () => {
      const id = tab.dataset.film as FilmId;
      for (const other of tabs) other.setAttribute("aria-selected", String(other === tab));
      if (video.getAttribute("src") === FILMS[id].src) return;
      const started = section.dataset.started !== undefined;
      video.poster = FILMS[id].poster;
      video.src = FILMS[id].src;
      if (started) void video.play();
    });
}
