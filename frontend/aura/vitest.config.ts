import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import { defineConfig } from "vitest/config";

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
		exclude: ["e2e/**", "node_modules/**", "playwright.config.ts"],
		coverage: {
			reporter: ["text", "json", "html"],
			exclude: ["e2e/**", "tests/**", "**/*.d.ts"],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
	},
	resolve: {
		alias: {
			"~~": resolve(root),
			"~/composables": resolve(root, "composables"),
			"~": resolve(root, "app"),
			"@": resolve(root, "app"),
		},
	},
});
