import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Integration tests run against a real, disposable Postgres database (TEST_DATABASE_URL, name must end in _test). */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/env.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
