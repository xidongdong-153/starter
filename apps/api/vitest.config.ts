import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@api/": `${path.resolve(import.meta.dirname, "src")}/`,
    },
  },
  test: { environment: "node", fileParallelism: false, testTimeout: 20_000 },
});
