import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	forbidOnly: false,
	retries: 1,
	workers: 1,
	reporter: "line",
	timeout: 30_000,
	expect: {
		timeout: 5000,
	},
	// Pre-compile every page with a real browser before tests start — Nuxt dev
	// compiles on demand, and dynamic imports issued mid-compile fail with
	// "Failed to fetch dynamically imported module".
	globalSetup: "./e2e/global-setup.ts",
	use: {
		baseURL: "http://localhost:34567",
		trace: "on-first-retry",
	},
	webServer: {
		command: "pnpm dev --port 34567",
		url: "http://localhost:34567",
		reuseExistingServer: true,
		timeout: 120_000,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
