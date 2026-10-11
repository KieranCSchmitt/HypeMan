import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: { "@core": resolve(process.cwd(), "packages/core/src/index.ts") } },
  test: { include: ["apps/extension/src/runtime/*.test.ts"], environment: "jsdom" },
});
