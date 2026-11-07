import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

export const FPS = 30;
export const PICTURE = { width: 1280, height: 800 };
export const CAPTION_HEIGHT = 96;
const VIEWPORT = { width: 1120, height: 700 };
const CAMERA_SECONDS = 1.4;
const DIP_FRAMES = 12;
const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif';
const INK = "#d0cec6";
const GROUND = "#110f0e";

// Where the film looks, in the page's own pixels. The guide look runs on down into the caption band, which is empty
// during a walkthrough, so the day chart is seen whole instead of cut off at the picture's edge.
const LOOKS = {
  whole: { x: 0, y: 0, width: 1120 },
  message: { x: 0, y: 330, width: 592 },
  guide: { x: 240, y: 84, width: 880 },
} as const;
type Look = keyof typeof LOOKS;

export interface Shot {
  start: number;
  end: number;
  caption: string | null;
  look: Look;
}

// Words on a black screen, over the footage, which keeps running behind it.
interface Card {
  start: number;
  end: number;
  text: string;
  small: string | null;
}

// A film can open on separately filmed footage, kept in its own folder beside the main frames.
interface Opening {
  seconds: number;
  shots: Shot[];
  frames: string;
  cards?: Card[];
}

export type FilmData = {
  seconds: number;
  shots: Shot[];
  opening?: Opening;
  cards?: Card[];
};

const glide = Easing.bezier(0.45, 0, 0.2, 1);

function cameraAt(seconds: number, shots: Shot[]) {
  const index = shots.findIndex((shot) => seconds < shot.end);
  const shot = shots[index < 0 ? shots.length - 1 : index];
  const previous = shots[Math.max(0, (index < 0 ? shots.length - 1 : index) - 1)];
  const toward = LOOKS[shot.look];
  const from = LOOKS[previous.look];
  const progress = interpolate(seconds - shot.start, [0, CAMERA_SECONDS], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: glide,
  });
  const mix = (a: number, b: number) => a + (b - a) * progress;
  return { x: mix(from.x, toward.x), y: mix(from.y, toward.y), width: mix(from.width, toward.width), shot };
}

const CARD_FADE_SECONDS = 0.45;

// A film that begins or ends on a card is simply black there, so its first frame, the thumbnail, has nothing behind it.
function BlackCard({ card, seconds, length }: { card: Card; seconds: number; length: number }) {
  const opacity = interpolate(
    seconds,
    [card.start, card.start + CARD_FADE_SECONDS, card.end - CARD_FADE_SECONDS, card.end],
    [card.start <= 0 ? 1 : 0, 1, 1, card.end >= length - 0.05 ? 1 : 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill
      style={{
        background: "#000",
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 150px",
        gap: 26,
        textAlign: "center",
        fontFamily: FONT,
      }}
    >
      <div style={{ color: "#f2f0ea", fontSize: 62, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.15 }}>{card.text}</div>
      {card.small ? <div style={{ color: "#a19e97", fontSize: 32, lineHeight: 1.35 }}>{card.small}</div> : null}
    </AbsoluteFill>
  );
}

export function Film({ seconds: filmSeconds, shots, opening, cards }: FilmData) {
  const frame = useCurrentFrame();
  if (!shots.length) return null;
  const openingFrames = Math.floor((opening?.seconds ?? 0) * FPS);
  const inOpening = opening !== undefined && frame < openingFrames;
  const footage = inOpening ? frame : frame - openingFrames;
  const seconds = footage / FPS;
  const { x, y, width, shot } = cameraAt(seconds, inOpening ? opening.shots : shots);
  const folder = inOpening ? opening.frames : "frames";
  const scale = PICTURE.width / width;
  // The time-lapse's captions cut with its pace.
  const opacity = inOpening ? 1 : interpolate(seconds - shot.start, [0, 0.25], [0, 1], { extrapolateRight: "clamp" });
  const caption = seconds >= shot.start ? shot.caption : null;
  // A short dip to dark between the opening and the take, so the change of scene has room to breathe.
  const dark = opening
    ? interpolate(frame, [openingFrames - DIP_FRAMES, openingFrames, openingFrames + DIP_FRAMES], [0, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;
  return (
    <AbsoluteFill style={{ background: GROUND }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <Img
          src={staticFile(`${folder}/f${String(footage).padStart(5, "0")}.jpg`)}
          style={{
            position: "absolute",
            left: -x * scale,
            top: -y * scale,
            width: VIEWPORT.width * scale,
            height: VIEWPORT.height * scale,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: PICTURE.height,
          height: CAPTION_HEIGHT,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: INK,
          opacity,
          fontFamily: FONT,
          fontSize: 46,
          fontWeight: 400,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
        }}
      >
        {caption}
      </div>
      <div style={{ position: "absolute", inset: 0, background: GROUND, opacity: dark }} />
      {(inOpening ? (opening.cards ?? []) : (cards ?? []))
        .filter((card) => seconds >= card.start && seconds < card.end)
        .map((card) => (
          <BlackCard key={card.start} card={card} seconds={seconds} length={inOpening ? Infinity : filmSeconds} />
        ))}
    </AbsoluteFill>
  );
}
