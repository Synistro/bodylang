import type { IncomingMessage, ServerResponse } from "node:http";
import { encodeEvent, ExplainEvent, TellEvent } from "../src/wire";

// What a route's request is too big or too broken to read. It answers as a 400.
export class BadRequest extends Error {}

export async function readJson(req: IncomingMessage, mostBytes: number): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > mostBytes) throw new BadRequest("Request too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadRequest("Request isn't JSON");
  }
}

export interface EventStream {
  send(event: TellEvent | ExplainEvent): void;
  stopped: AbortController; // aborted when the reader leaves
}

export function openEventStream(res: ServerResponse): EventStream {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const stopped = new AbortController();
  // The request stream is finished once its body has been read, so only the response reports a disconnect.
  res.on("close", () => {
    if (!res.writableEnded) stopped.abort();
  });
  return { send: (event) => void res.write(encodeEvent(event)), stopped };
}
