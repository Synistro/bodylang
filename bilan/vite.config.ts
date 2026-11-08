import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The bilan page builds into dist/site/bilan, beside the landing page and the app, which `pnpm build:site` builds first.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: { outDir: "../dist/site/bilan", emptyOutDir: true },
});
