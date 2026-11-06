import { z } from "zod";

// Everything that crosses between the browser and the dev server, defined once so both sides agree.

const BUILD_STAGES = ["writing", "testing", "final", "ready", "failed", "stopped"] as const;
export const buildStatusSchema = z.object({
  id: z.string(),
  title: z.string(),
  stage: z.enum(BUILD_STAGES),
  message: z.string().nullable(),
});
export type BuildStatus = z.infer<typeof buildStatusSchema>;
export type BuildStage = BuildStatus["stage"];

export const extendActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stop") }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("remove"), id: z.string() }),
]);
export type ExtendAction = z.infer<typeof extendActionSchema>;

export const dayPutSchema = z.object({ writer: z.string().min(1).max(100), doc: z.unknown() });

export const nameRequestSchema = z.object({ text: z.string().min(1).max(4000) });
export const nameReplySchema = z.object({ name: z.string().nullable() });

const replyLineSchema = z.object({
  text: z.string(),
  organ: z.string().optional(),
  unverified: z.array(z.string()).optional(),
});

export const tellEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reply"), lines: z.array(replyLineSchema) }),
  z.object({ type: z.literal("action"), name: z.string(), args: z.unknown() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);
export type TellEvent = z.infer<typeof tellEventSchema>;

export const explainEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);
export type ExplainEvent = z.infer<typeof explainEventSchema>;

export const encodeEvent = (event: TellEvent | ExplainEvent) => `data: ${JSON.stringify(event)}\n\n`;

// Reads a stream of encoded events as they arrive. An event that doesn't parse throws, and whoever is reading
// decides what that stops.
export async function* readEvents<T>(response: Response, schema: z.ZodType<T>): AsyncGenerator<T> {
  if (!response.body) throw new Error("The server sent nothing to read.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf("\n\n");
      if (chunk.startsWith("data: ")) yield schema.parse(JSON.parse(chunk.slice(6)));
    }
  }
}
