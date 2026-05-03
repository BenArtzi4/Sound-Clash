import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.config.{ts,js}",
        "src/main.tsx",
        "src/test-setup.ts",
        "**/dist/**",
        "**/node_modules/**",
      ],
      // Phase 1 starts low; ratchet up at end of each phase per
      // ../docs/testing-strategy.md §5
      thresholds: {
        lines: 0,
        branches: 0,
        functions: 0,
        statements: 0,
      },
    },
  },
});
