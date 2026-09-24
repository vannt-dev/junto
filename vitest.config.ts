import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    // Integration tests spawn git and gate processes; Windows runners can exceed the 5s default.
    testTimeout: 20_000,
  },
})
