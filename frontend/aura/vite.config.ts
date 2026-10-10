import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import { defineConfig } from "vite-plus";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));

// Vite+ toolchain config (the `vp` CLI): `vp` is the outer command — it owns the
// package manager (`vp install`), Vitest (`vp test`), and Oxlint/Oxfmt (`vp check` /
// `vp lint` / `vp fmt`). Nuxt-owned commands (build/dev/preview/typecheck/prepare) are
// reached through `vp run nuxt:*` (the `vp` built-in dev/build are for plain Vite apps,
// not Nuxt's Nitro build). This standalone config is the Vite+ entrypoint only — the
// Nuxt build keeps its own config in nuxt.config.ts (nuxt/nuxt discussion #34857:
// Vite+ in Nuxt works through a standalone vite.config.ts, not the nuxt `vite` key).
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
	// `vp fmt` / `vp check` — Oxfmt, configured to match the pre-migration
	// Biome conventions (tab indent, width 100, double quotes) so the switch
	// to Vite+ reformats minimally.
	fmt: {
		useTabs: true,
		tabWidth: 2,
		printWidth: 100,
		singleQuote: false,
		trailingComma: "all",
		semi: true,
	},
	// `vp test` — Vitest 5 (bundled with vite-plus). Config migrated from the
	// former vitest.config.ts (vite+ adoption).
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
