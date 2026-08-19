/**
 * Nonce-based Content-Security-Policy helper for the SSR HTML response
 * (RIL DEC-057 / TASK-126).
 *
 * Nuxt 4 removed the `csp` config option, so the policy is emitted manually: a
 * per-request nonce is attached to every inline `<script>` the renderer
 * produces (importmap, theme bootstrap, JSON-LD, Nuxt payload) and the header
 * is set by the nitro plugin that consumes these helpers.
 *
 * Security posture:
 * - `script-src 'self' 'nonce-…'` — no `'unsafe-inline'`. Inline scripts only
 *   run with the per-request nonce; same-origin Vite bundles load via
 *   `script-src 'self'`.
 * - `style-src 'self' 'unsafe-inline'` — required by KaTeX/Mermaid, which
 *   inject `<style>` tags and `style=""` attributes at runtime in the browser.
 *   Inline styles are a lower risk class than inline scripts (no script
 *   execution), so this is accepted per DEC-057.
 * - All script/css assets are same-origin Vite bundles — there are no
 *   third-party CDN scripts to protect with SRI, so SRI is intentionally out
 *   of scope for this policy (null threat model, recorded in DEC-057).
 */

/** Matches an opening `<script>` tag that is inline (no `src=`) and not yet nonced. */
const INLINE_SCRIPT_RE = /<script\b(?![^>]*\b(?:src|nonce)=)[^>]*>/gi;

/**
 * Add `nonce="<nonce>"` to every inline `<script>` opening tag in an HTML
 * fragment. Leaves tags that already carry `src` (same-origin module scripts,
 * allowed by `script-src 'self'`) or an existing `nonce` untouched.
 */
export function addNonceToInlineScripts(fragment: string, nonce: string): string {
	return fragment.replace(INLINE_SCRIPT_RE, (tag) =>
		// `<script>` -> `<script nonce="…">`; self-closing tags stay untouched.
		tag.endsWith("/>") ? tag : `${tag.slice(0, -1)} nonce="${nonce}">`,
	);
}

export interface CspPolicyOptions {
	/**
	 * Absolute API base URL the browser may call directly. Only needed when the
	 * client uses an absolute `NUXT_API_URL`; with the default (empty) value the
	 * app talks to the same-origin `/api` proxy, so `connect-src 'self'` covers it.
	 */
	apiUrl?: string;
	/** Relax the policy so vite dev tooling (HMR websocket, eval) keeps working. */
	dev?: boolean;
}

/**
 * Build the Content-Security-Policy value for the frontend HTML document.
 */
export function buildCspPolicy(nonce: string, options: CspPolicyOptions = {}): string {
	const scriptSources = ["'self'", `'nonce-${nonce}'`];
	const connectSources = ["'self'"];

	if (options.dev) {
		// vite dev server: HMR over websocket + dynamic import/eval for dev-only code.
		scriptSources.push("'unsafe-inline'", "'unsafe-eval'");
		connectSources.push("ws://localhost:*", "http://localhost:*");
	}

	if (options.apiUrl) {
		try {
			const { origin } = new URL(options.apiUrl);
			if (origin && origin !== "null") connectSources.push(origin);
		} catch {
			// Malformed apiUrl — fall back to 'self' (the proxied /api path).
		}
	}

	return [
		"default-src 'self'",
		`script-src ${scriptSources.join(" ")}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		`connect-src ${connectSources.join(" ")}`,
		"object-src 'none'",
		"base-uri 'self'",
		"frame-ancestors 'none'",
		"form-action 'self'",
	].join("; ");
}

/** Other security headers applied to the frontend HTML response (parity with the API). */
export const HTML_SECURITY_HEADERS: Record<string, string> = {
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"X-XSS-Protection": "1; mode=block",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	"Cross-Origin-Opener-Policy": "same-origin",
	"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};
