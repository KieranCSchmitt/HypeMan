import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: { "@core": resolve(import.meta.dirname, "packages/core/src/index.ts") } },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    maxWorkers: 2,
    testTimeout: 15000,
  },
});
