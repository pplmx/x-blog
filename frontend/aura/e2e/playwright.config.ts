import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	fullyParallel: false,
	forbidOnly: false,
	retries: 1,
	workers: 1,
	reporter: "line",
	timeout: 30_000,
	expect: {
		timeout: 5000,
	},
	use: {
		baseURL: "http://localhost:13334",
		trace: "on-first-retry",
	},
	// Only match .spec.ts files in the e2e directory,
	// exclude vitest tests in ../tests/
	testMatch: "**/*.spec.ts",
	exclude: ["../tests/**", "**/tests/**"],
	webServer: {
		command: "pnpm dev --port 13334",
		cwd: "..",
		url: "http://localhost:13334",
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
