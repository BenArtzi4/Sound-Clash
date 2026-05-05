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
        "src/test/**",
        "src/vite-env.d.ts",
        "**/dist/**",
        "**/node_modules/**",
      ],
      // Phase 5 ratchet per ../docs/testing-strategy.md §5
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 85,
        statements: 85,
      },
    },
  },
});
