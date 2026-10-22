/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export default defineConfig({
  root: fileURLToPath(new URL("./tauri-runtime", import.meta.url)),
  base: "./",
  envDir: false,
  plugins: [
    {
      name: "freelens:browser-only",
      enforce: "pre",
      resolveId(id) {
        if (id === "electron" || id.startsWith("node:") || builtins.has(id)) {
          throw new Error(`Tauri frontend cannot import host module: ${id}`);
        }
      },
    },
    react(),
  ],
  css: {
    postcss: { plugins: [tailwindcss()] },
    modules: { generateScopedName: "[name]__[local]--[hash:base64:5]" },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/tauri", import.meta.url)),
    target: "safari15",
    assetsInlineLimit: 0,
  },
});
