// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from "vite";

// Standard Tauri v2 + Vite setup: dev server on port 1420 (strict), no HMR
// churn from src-tauri edits.
export default defineConfig({
  clearScreen: false,
  // Single source of truth for the app icon: assets/icon-1024.png is served
  // at /icon-1024.png in dev and copied verbatim into dist for production.
  publicDir: "assets",
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
