/**
 * Playwright global setup: pre-warm the Nuxt dev server.
 *
 * Nuxt dev compiles page modules on demand. The first request to a page
 * triggers a compile that can take seconds, and a browser dynamic-import
 * issued mid-compile fails with "Failed to fetch dynamically imported
 * module" — every admin e2e test then needs a retry (or fails).
 *
 * Visiting each route with a real browser before any test starts forces the
 * server to compile every page (SSR + client chunk) once, so the tests never
 * race a compile.
 */

import { chromium } from "@playwright/test";

const BASE = "http://localhost:34567";

const ROUTES = [
	"/",
	"/about",
	"/search",
	"/tags",
	"/categories",
	"/admin/login",
	"/admin",
	"/admin/posts",
	"/admin/posts/new",
	"/admin/categories",
	"/admin/tags",
	"/admin/comments",
];

export default async function globalSetup() {
	const browser = await chromium.launch();
	const page = await browser.newPage();
	try {
		for (const route of ROUTES) {
			try {
				await page.goto(`${BASE}${route}`, {
					waitUntil: "networkidle",
					timeout: 30_000,
				});
			} catch {
				// Warming failures are non-fatal — real issues surface as
				// test failures with full error context.
			}
		}
	} finally {
		await browser.close();
	}
}
