import type { ReactNode, RefObject } from "react";
import "./insets.css";

export const ART_WIDTH = 240;
export const ART_HEIGHT = 180;
const ART_TEXT_SIZE = 7.2; // in figure units, so it keeps its proportion to the drawing
const CAPTION_AT = { x: 8, y: 13, noteY: 21 }; // inside the rounded edge of the figure's card

export interface PlateWords {
  caption: string; // one short label and the number, set inside the figure
  captionHint?: string; // what the plain word stands for, on hover
  note?: { text: string; tone?: "attention" }; // a quieter second line, only when the figure needs it
  describe: string; // what a screen reader gets in place of the drawing
}

interface PlateProps extends PlateWords {
  artRef: RefObject<SVGSVGElement | null>;
  children: ReactNode;
}

export function Plate({ caption, captionHint, note, describe, artRef, children }: PlateProps) {
  return (
    <figure className="inset">
      <svg
        ref={artRef}
        className="inset-art"
        viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`}
        fontSize={ART_TEXT_SIZE}
        role="img"
        aria-label={describe}
      >
        {children}
        <text className="inset-caption" x={CAPTION_AT.x} y={CAPTION_AT.y}>
          {captionHint ? <title>{captionHint}</title> : null}
          {caption}
        </text>
        {note ? (
          <text className="inset-note" data-tone={note.tone} x={CAPTION_AT.x} y={CAPTION_AT.noteY}>
            {note.text}
          </text>
        ) : null}
      </svg>
    </figure>
  );
}
