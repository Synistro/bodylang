import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import { BadRequest, Notify, readJson } from "./http";
import { requestProblem } from "./requestGuard";

type Handler = (req: IncomingMessage, res: ServerResponse, notify: Notify) => Promise<void> | void;

interface Route {
  methods: readonly string[];
  load: () => Promise<Handler>; // loaded when first called, so a file mid-edit only breaks its own route
}

const BEACON_MOST_BYTES = 4000;

// Reports from a page nobody can watch, such as the wallpaper.
const handleBeacon: Handler = async (req, res) => {
  console.log(`[beacon] ${JSON.stringify(await readJson(req, BEACON_MOST_BYTES))}`);
  res.statusCode = 204;
  res.end();
};

const ROUTES: Record<string, Route> = {
  "/tell": { methods: ["POST"], load: async () => (await import("./tell")).handleTell },
  "/day": { methods: ["GET", "PUT"], load: async () => (await import("./days")).handleDay },
  "/extend": { methods: ["GET", "POST"], load: async () => (await import("./extend")).handleExtend },
  "/explain": { methods: ["POST"], load: async () => (await import("./explain")).handleExplain },
  "/name-question": { methods: ["POST"], load: async () => (await import("./explain")).handleNameQuestion },
  "/beacon": { methods: ["POST"], load: async () => handleBeacon },
};

const finish = (res: ServerResponse, status: number, message = "") => {
  res.statusCode = status;
  res.end(message);
};

export async function handleApi(req: IncomingMessage, res: ServerResponse, notify: Notify, routes: Record<string, Route> = ROUTES) {
  const path = (req.url ?? "/").split("?")[0];
  const problem = requestProblem(req.method, req.headers);
  if (problem) return finish(res, problem.status, problem.message);
  const route = Object.hasOwn(routes, path) ? routes[path] : null;
  if (!route) return finish(res, 404, `No route ${path}`);
  if (!route.methods.includes(req.method ?? "")) return finish(res, 405, `${path} takes ${route.methods.join(", ")}`);
  try {
    const handler = await route.load();
    await handler(req, res, notify);
  } catch (e: unknown) {
    console.error(`[bodylang] ${path}`, e);
    const message = e instanceof Error ? e.message : String(e);
    if (res.headersSent) res.end();
    else finish(res, e instanceof BadRequest || e instanceof ZodError ? 400 : 500, message);
  }
}
