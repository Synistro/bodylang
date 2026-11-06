import type { IncomingHttpHeaders } from "node:http";

export interface RequestProblem {
  status: number;
  message: string;
}

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
};

// Any web page you have open can send a plain-text POST to localhost with no preflight, and these routes spend
// money and write code. Requiring JSON forces a browser to ask first, and a foreign Origin is turned away here.
export function requestProblem(method: string | undefined, headers: IncomingHttpHeaders): RequestProblem | null {
  if (method === "GET" || method === "HEAD") return null;
  const { origin, host } = headers;
  if (origin !== undefined && hostOf(origin) !== host) return { status: 403, message: `Requests from ${origin} aren't allowed.` };
  if (!headers["content-type"]?.startsWith("application/json")) return { status: 415, message: "This route only takes JSON." };
  return null;
}
