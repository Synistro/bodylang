import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The landing page builds on its own into dist/site, and `pnpm build:site` builds the app into dist/site/app beside it.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: { outDir: "../dist/site", emptyOutDir: true },
});
