import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the rarely-changing framework runtime into its own long-lived
        // chunk. App code churns every deploy; React/router don't — so a return
        // visitor re-downloads only the small app entry and reuses the
        // immutably-cached vendor chunk (see public/_headers). (Vite 8 / Rolldown
        // only accepts the function form of manualChunks, not the object form.)
        manualChunks: (id) =>
          /[\\/]node_modules[\\/](react-dom|react-router-dom|react-router|react|scheduler)[\\/]/.test(
            id,
          )
            ? "vendor"
            : undefined,
      },
    },
  },
});
