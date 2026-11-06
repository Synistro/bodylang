import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import type { Notify } from "./server/routes";
import { configDefaults, defineConfig } from "vitest/config";

// The bridge lives in the dev server so the page has one origin and no key ever reaches the browser.
// It is loaded per request instead of imported here: an import would make every model file a config
// dependency, and each edit would restart the server and strand the wallpaper on a dead page.
function bodyAgent(): Plugin {
  return {
    name: "bodylang-agent",
    configureServer(server) {
      const notify: Notify = {
        buildChanged: (status) => server.ws.send("bodylang:build", status),
        dayChanged: (writer) => server.ws.send("bodylang:day", { writer }),
      };
      server.middlewares.use("/api", (req, res) => {
        server
          .ssrLoadModule("/server/routes.ts")
          .then((routes) => (routes as typeof import("./server/routes")).handleApi(req, res, notify))
          .catch((e: unknown) => {
            console.error("[bodylang] a server file failed to load", e);
            res.statusCode = 500;
            res.end(e instanceof Error ? e.message : String(e));
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
