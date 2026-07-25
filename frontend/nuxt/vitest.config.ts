import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import AutoImport from "unplugin-auto-import/vite";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: ["vue"],
      dirs: [resolve(root, "composables")],
      dts: false,
      // Don't generate a separate auto-imports.d.ts — Nuxt handles types
    }),
  ],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "~": resolve(root, "app"),
      "@": resolve(root, "app"),
    },
  },
});
