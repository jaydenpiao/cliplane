import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false },
  resolve: {
    alias: { "@cliplane/domain": new URL("./packages/domain/src/index.ts", import.meta.url).pathname },
  },
});
