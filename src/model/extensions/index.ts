import type { ProcessExtension } from "./api";

// Every process Claude has added. A new file here is picked up without touching anything else.
const modules = import.meta.glob<{ extension: ProcessExtension }>(
  ["./*.ts", "!./api.ts", "!./index.ts", "!./check.ts", "!./*.test.ts"],
  { eager: true },
);

export const EXTENSIONS: readonly ProcessExtension[] = Object.values(modules).map((module) => module.extension);
