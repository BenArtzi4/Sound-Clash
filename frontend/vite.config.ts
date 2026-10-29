import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    // The server build (`vite build --ssr src/entry-server.tsx`, see
    // scripts/prerender.mjs) writes beside dist/, never into it: it is a
    // build-time renderer, not something to deploy.
    outDir: isSsrBuild ? "dist-ssr" : "dist",
    sourcemap: !isSsrBuild,
    // The client build's manifest tells scripts/prerender.mjs which stylesheet
    // and chunks each lazy page needs; the script deletes it afterwards.
    manifest: !isSsrBuild,
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
}));
