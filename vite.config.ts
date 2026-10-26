import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwind(),
    {
      name: "icekube-react-devtools",
      transformIndexHtml(html) {
        if (command !== "serve" || process.env.ICEKUBE_REACT_DEVTOOLS !== "1") {
          return html;
        }

        return {
          html,
          tags: [
            {
              tag: "script",
              attrs: { src: "http://127.0.0.1:8097" },
              injectTo: "head-pre",
            },
          ],
        };
      },
    },
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
