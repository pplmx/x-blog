/**
 * Unit tests for the nonce-based CSP helpers (RIL DEC-057 / TASK-126).
 * The nitro plugin wiring itself is exercised by the e2e CSP journey.
 */

import { describe, expect, it } from "vitest";

import {
	addNonceToInlineScripts,
	buildCspPolicy,
	HTML_SECURITY_HEADERS,
} from "../../server/utils/csp";

describe("addNonceToInlineScripts", () => {
	const NONCE = "abc-123_final==";

	it("nonces a plain inline script", () => {
		expect(addNonceToInlineScripts("<script>(function(){})()</script>", NONCE)).toBe(
			`<script nonce="${NONCE}">(function(){})()</script>`,
		);
	});

	it("nonces typed inline scripts (JSON-LD, importmap, payload)", () => {
		const fragment =
			'<script type="application/ld+json">{"@type":"WebSite"}</script>' +
			'<script type="importmap">{"imports":{}}</script>' +
			'<script type="application/json" data-nuxt-data id="__NUXT_DATA__">[]</script>';
		const out = addNonceToInlineScripts(fragment, NONCE);
		expect(out).toBe(
			`<script type="application/ld+json" nonce="${NONCE}">{"@type":"WebSite"}</script>` +
				`<script type="importmap" nonce="${NONCE}">{"imports":{}}</script>` +
				`<script type="application/json" data-nuxt-data id="__NUXT_DATA__" nonce="${NONCE}">[]</script>`,
		);
	});

	it("leaves external scripts (src=) untouched — allowed by script-src 'self'", () => {
		const tag = '<script type="module" src="/_nuxt/entry.js" crossorigin>';
		expect(addNonceToInlineScripts(tag, NONCE)).toBe(tag);
	});

	it("leaves an already-nonced script untouched", () => {
		const tag = `<script nonce="${NONCE}">code()</script>`;
		expect(addNonceToInlineScripts(tag, "different-nonce")).toBe(tag);
	});

	it("handles a whole document fragment with mixed tags", () => {
		const out = addNonceToInlineScripts(
			"<head><script>a()</script><script src='/x.js'></script></head><body><script type=module>b()</script></body>",
			NONCE,
		);
		expect(out).not.toContain(`<script>a()</script>`);
		expect(out).toContain(`<script nonce="${NONCE}">a()</script>`);
		expect(out).toContain("<script src='/x.js'></script>");
		// A module-less inline script without explicit quotes keeps its attrs.
		expect(out).toContain(`<script type=module nonce="${NONCE}">b()</script>`);
	});

	it("leaves self-closing tags untouched", () => {
		const tag = "<script src='/x.js'/>";
		expect(addNonceToInlineScripts(tag, NONCE)).toBe(tag);
	});
});

describe("buildCspPolicy", () => {
	it("bases everything on 'self' and pins the nonce into script-src", () => {
		const csp = buildCspPolicy("n1", {});
		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("script-src 'self' 'nonce-n1'");
	});

	it("does NOT allow unsafe-inline in production script-src", () => {
		const csp = buildCspPolicy("n1", {});
		const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? "";
		expect(scriptSrc).not.toContain("'unsafe-inline'");
		expect(scriptSrc).not.toContain("'unsafe-eval'");
	});

	it("keeps style-src permissive for KaTeX/Mermaid runtime injection", () => {
		expect(buildCspPolicy("n1", {})).toContain("style-src 'self' 'unsafe-inline'");
	});

	it("adds the API origin to connect-src when an absolute apiUrl is set", () => {
		const csp = buildCspPolicy("n1", { apiUrl: "https://api.example.com" });
		expect(csp).toContain("connect-src 'self' https://api.example.com");
	});

	it("defaults connect-src to 'self' (proxied /api path)", () => {
		expect(buildCspPolicy("n1", {})).toContain("connect-src 'self'");
	});

	it("does not repeat the same origin when apiUrl is same-origin-shaped", () => {
		const csp = buildCspPolicy("n1", { apiUrl: "http://localhost:34567" });
		expect(csp).toContain("connect-src 'self' http://localhost:34567");
	});

	it("ignores a malformed apiUrl", () => {
		expect(buildCspPolicy("n1", { apiUrl: "not a url" })).toContain("connect-src 'self'");
	});

	it("relaxes script-src and connect-src in dev for vite HMR", () => {
		const csp = buildCspPolicy("n1", { dev: true });
		expect(csp).toContain("'unsafe-inline'");
		expect(csp).toContain("'unsafe-eval'");
		expect(csp).toContain("ws://localhost:*");
	});

	it("locks down objects, base, framing and forms", () => {
		const csp = buildCspPolicy("n1", {});
		expect(csp).toContain("object-src 'none'");
		expect(csp).toContain("base-uri 'self'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("form-action 'self'");
	});
});

describe("HTML_SECURITY_HEADERS", () => {
	it("covers the baseline hardening set on the frontend HTML", () => {
		expect(HTML_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
		expect(HTML_SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
		expect(HTML_SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
		expect(HTML_SECURITY_HEADERS["Permissions-Policy"]).toContain("geolocation=()");
	});
});
