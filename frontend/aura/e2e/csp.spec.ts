/**
 * Content-Security-Policy browser verification (RIL DEC-057 / TASK-127).
 *
 * DEC-051 deferred CSP because it "needs live-browser verification" — this
 * suite is that verification. The Nuxt app is served with a nonce-based policy
 * (server/plugins/csp.ts); these tests prove the enforced policy:
 *  1. The CSP header is present with a per-request nonce, every inline SSR
 *     script carries that nonce, and the baseline security headers are set.
 *  2. Pages hydrate and render under the strict policy with ZERO CSP
 *     violations — including the KaTeX/Mermaid post whose runtime style
 *     injection is exactly what a naive policy would break.
 *  3. The inline theme-bootstrap executes (nonce'd inline script actually runs)
 *     and the inline JSON-LD is emitted intact.
 */

import { expect, test } from "@playwright/test";

const CSP_VIOLATION_RE =
	/Content Security Policy|Refused to (execute|apply|evaluate|load|connect|frame)/i;

/** Collect CSP policy-violation console messages for the rest of the test. */
function watchCspViolations(page: import("@playwright/test").Page): string[] {
	const violations: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error" && CSP_VIOLATION_RE.test(msg.text())) {
			violations.push(msg.text());
		}
	});
	return violations;
}

function nonceFrom(csp: string | undefined): string | null {
	if (!csp) return null;
	const m = csp.match(/'nonce-([^']+)'/);
	return m ? m[1] : null;
}

/** Wait for Vue to finish hydration (`__vue_app__` on the #__nuxt mount). */
async function waitForHydration(page: import("@playwright/test").Page) {
	await page.waitForFunction(() => {
		const root = document.getElementById("__nuxt");
		return Boolean(root && (root as HTMLElement & { __vue_app__?: unknown }).__vue_app__);
	});
}

test("SSR HTML is served with a nonce-based CSP and matches inline scripts", async ({ page }) => {
	const response = await page.request.get("/");
	expect(response.status()).toBe(200);
	const headers = response.headers();
	const csp = headers["content-security-policy"];
	expect(csp, "CSP header must be present on the HTML document").toBeTruthy();
	expect(csp).toContain("default-src 'self'");
	expect(csp).toContain("script-src 'self' 'nonce-");
	// 'unsafe-inline' is only allowed for styles (KaTeX/Mermaid runtime
	// injection); it must NEVER appear in the script directive.
	const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? "";
	expect(scriptSrc).not.toContain("'unsafe-inline'");
	expect(csp).toContain("object-src 'none'");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain("base-uri 'self'");
	expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
	expect(headers["x-content-type-options"]).toBe("nosniff");
	expect(headers["x-frame-options"]).toBe("DENY");

	const nonce = nonceFrom(csp);
	expect(nonce, "the policy must carry a nonce the inline scripts can share").toBeTruthy();

	// Every inline (src-less) script in the raw emitted HTML must carry the
	// header's nonce; external modules keep their src and need no nonce.
	const html = await response.text();
	const inline = /<script\b(?![^>]*\bsrc=)[^>]*>/g;
	const tags = [...html.matchAll(inline)].map((m) => m[0]);
	expect(tags.length).toBeGreaterThan(0);
	const unnonced = tags.filter((tag) => !tag.includes(`nonce="${nonce}"`));
	expect(unnonced, `inline scripts missing the nonce: ${unnonced.join(", ")}`).toEqual([]);
});

test("pages hydrate under the strict policy with zero CSP violations (incl. KaTeX/Mermaid)", async ({
	page,
}) => {
	const violations = watchCspViolations(page);
	await page.goto("/");
	await waitForHydration(page);
	expect(violations, `CSP violations on home: ${violations.join(" | ")}`).toEqual([]);

	violations.length = 0;
	await page.goto("/posts/welcome-to-x-blog");
	// KaTeX + Mermaid load via dynamic imports and inject <style> at runtime;
	// give them time, then confirm they actually rendered — not just that no
	// violation fired (a blocked script fails silently).
	await expect(page.locator(".katex").first()).toBeVisible({ timeout: 10_000 });
	await expect(page.locator("div[data-mermaid-key] svg").first()).toBeVisible({
		timeout: 10_000,
	});
	await waitForHydration(page);
	await page.waitForTimeout(500);
	expect(violations, `CSP violations on math+mermaid post: ${violations.join(" | ")}`).toEqual([]);
});

test("inline theme bootstrap executes and JSON-LD is emitted under the policy", async ({
	page,
}) => {
	// The theme bootstrap is an inline <script> (nuxt.config app.head). If the
	// nonce failed, the browser would refuse to run it and dark mode would not
	// apply pre-hydration — this is direct proof the inline script executed.
	await page.addInitScript(() => localStorage.setItem("theme", "dark"));

	const violations = watchCspViolations(page);
	await page.goto("/");
	await expect(page.locator("html")).toHaveClass(/dark/);
	await waitForHydration(page);
	expect(violations, `CSP violations during theme bootstrap: ${violations.join(" | ")}`).toEqual(
		[],
	);

	const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
	expect(jsonLd, "inline JSON-LD must be present").toBeTruthy();
	const parsed = JSON.parse(jsonLd as string) as unknown;
	const nodes = Array.isArray(parsed) ? parsed : [parsed];
	expect(
		nodes.some((n) => typeof n === "object" && n !== null && "@type" in n),
		"JSON-LD must describe a typed entity (e.g. WebSite)",
	).toBe(true);
});
