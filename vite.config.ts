import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

// The bridge lives in the dev server so the page has one origin and no key ever reaches the browser.
// It is loaded per request instead of imported here: an import would make every model file a config
// dependency, and each edit would restart the server and strand the wallpaper on a dead page.
function bodyAgent(): Plugin {
  return {
    name: "bodylang-agent",
    configureServer(server) {
      server.middlewares.use("/api/beacon", (req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          console.log(`[beacon] ${Buffer.concat(chunks).toString("utf8").slice(0, 400)}`);
          res.statusCode = 204;
          res.end();
        });
      });
      server.middlewares.use("/api/snapshot", (req, res) => {
        if (req.method === "GET") {
          server.ws.send("bodylang:snapshot");
          res.end("requested");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const base64 = Buffer.concat(chunks).toString("utf8").split(",")[1] ?? "";
          mkdirSync("pipeline/cache", { recursive: true });
          writeFileSync("pipeline/cache/snapshot.jpg", Buffer.from(base64, "base64"));
          res.statusCode = 204;
          res.end();
        });
      });
      server.middlewares.use("/api/day", (req, res) => {
        server
          .ssrLoadModule("/server/days.ts")
          .then((days) => (days as typeof import("./server/days")).handleDay(req, res, (writer) => server.ws.send("bodylang:day", { writer })))
          .catch((e: unknown) => {
            console.error("[bodylang] day file error", e);
            if (!res.headersSent) res.statusCode = 400;
            res.end(e instanceof Error ? e.message : String(e));
          });
      });
      server.middlewares.use("/api/extend", (req, res) => {
        server
          .ssrLoadModule("/server/extend.ts")
          .then((extend) => (extend as typeof import("./server/extend")).handleExtend(req, res))
          .catch((e: unknown) => {
            console.error("[bodylang] extend error", e);
            if (!res.headersSent) res.statusCode = 400;
            res.end(e instanceof Error ? e.message : String(e));
          });
      });
      server.middlewares.use("/api/name-question", (req, res) => {
        server
          .ssrLoadModule("/server/explain.ts")
          .then((explain) => (explain as typeof import("./server/explain")).handleNameQuestion(req, res))
          .catch((e: unknown) => {
            console.error("[bodylang] naming error", e);
            if (!res.headersSent) res.statusCode = 400;
            res.end();
          });
      });
      server.middlewares.use("/api/explain", (req, res) => {
        server
          .ssrLoadModule("/server/explain.ts")
          .then((explain) => (explain as typeof import("./server/explain")).handleExplain(req, res))
          .catch((e: unknown) => {
            console.error("[bodylang] explain error", e);
            if (!res.headersSent) res.statusCode = 400;
            res.end();
          });
      });
      server.middlewares.use("/api/tell", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        server
          .ssrLoadModule("/server/agent.ts")
          .then((bridge) => (bridge as typeof import("./server/agent")).handleTell(req, res, (status) => server.ws.send("bodylang:build", status)))
          .catch((e: unknown) => {
            console.error("[bodylang] request error", e);
            if (!res.headersSent) res.statusCode = 400;
            res.end();
          });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), bodyAgent()],
  server: { port: 5183, strictPort: true },
  // The sweeps through a whole day take seconds, and more on a busy machine. These tests decide whether
  // a process Claude wrote goes in, so a slow moment must never read as a failure.
  test: { testTimeout: 60_000, exclude: [...configDefaults.exclude, "proofs/**"] },
});
