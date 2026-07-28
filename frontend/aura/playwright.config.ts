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
