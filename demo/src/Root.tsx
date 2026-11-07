import { Composition } from "remotion";
import { CAPTION_HEIGHT, Film, FilmData, FPS, PICTURE } from "./Film";

// A film's shots come from what the capture saved beside its frames (--props), so nothing here knows one film.
export function Root() {
  return (
    <Composition
      id="Film"
      component={Film}
      fps={FPS}
      width={PICTURE.width}
      height={PICTURE.height + CAPTION_HEIGHT}
      defaultProps={{ seconds: 1, shots: [] } as FilmData}
      calculateMetadata={({ props }) => ({
        // Each part rounds down the way it was filmed, so the total never asks for a frame that doesn't exist.
        durationInFrames: Math.max(1, Math.floor(props.seconds * FPS) + Math.floor((props.opening?.seconds ?? 0) * FPS)),
      })}
    />
  );
}
