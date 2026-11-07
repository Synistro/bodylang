import type { RecordedEvent } from "../wire";
import type { AskFor } from "./tell";

// A recorded answer arrives in the timing it really had, apart from the long waits while the LLM thought, which
// shrink to this, so a visitor sees the body start to change at once.
export const LONGEST_WAIT_MS = 900;

export function replayOf(events: RecordedEvent[], longestWaitMs = LONGEST_WAIT_MS): AskFor {
  const encoder = new TextEncoder();
  return (_request, signal) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let index = 0;
        let last = 0;
        const next = () => {
          if (index >= events.length) {
            controller.close();
            return;
          }
          const { ms, event } = events[index++];
          const wait = Math.min(Math.max(0, ms - last), longestWaitMs);
          last = ms;
          timer = setTimeout(() => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            next();
          }, wait);
        };
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          controller.error(new DOMException("Stopped", "AbortError"));
        });
        next();
      },
      cancel: () => clearTimeout(timer),
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  };
}
