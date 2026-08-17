/**
 * Code block syntax highlighting (lazy-loaded, client-only).
 *
 * Uses highlight.js with the bundled "common" language subset so a broad set
 * of popular languages (javascript, typescript, python, go, rust, c/cpp,
 * java, sql, bash, json, yaml, markdown, ...) highlight out of the box.
 *
 * highlight.js escapes the source before tokenising, so `highlightCode` always
 * returns safe HTML that can be rendered verbatim through v-html. Plaintext
 * and unknown languages fall back to HTML-escaped plain text (never raw
 * input), so the v-html guarantee holds even without a matching grammar.
 */

import type { HLJSApi } from "highlight.js";

export type Highlighter = HLJSApi;

let highlighterPromise: Promise<Highlighter | null> | null = null;

// Static helper exported so the component's SSR/fallback rendering can escape
// plain text with the same escaping highlight.js uses on source.
export function escapeHtml(code: string): string {
	return code
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Load highlight.js once across all component instances (client-only).
 * The module is dynamically imported so the ~400 KB grammar bundle stays out
 * of the server/SSR bundle and the post page's initial client chunk — the
 * same lazy, client-only strategy the project already uses for mermaid and
 * katex. Returns null when the module cannot be loaded, in which case
 * callers render plain escaped text.
 */
export async function loadHighlighter(): Promise<Highlighter | null> {
	if (!highlighterPromise) {
		highlighterPromise = (async () => {
			try {
				const mod = await import("highlight.js/lib/common");
				return mod.default ?? null;
			} catch {
				return null;
			}
		})();
	}
	return highlighterPromise;
}

/** Languages with no useful grammar — render as plain text. */
const PLAIN_LANGS: Record<string, true> = {
	"": true,
	text: true,
	plaintext: true,
	txt: true,
	plain: true,
	none: true,
};

/**
 * Return safe highlight HTML for `code` in `lang`. Falls back to
 * HTML-escaped plain text for plaintext/unknown languages and for any
 * highlight.js failure. Never returns unescaped input.
 */
export function highlightCode(h: Highlighter | null, lang: string, code: string): string {
	const normalized = (lang || "text").trim().toLowerCase();
	if (!h || PLAIN_LANGS[normalized]) {
		return escapeHtml(code);
	}
	try {
		return h.highlight(code, { language: normalized, ignoreIllegals: true }).value;
	} catch {
		return escapeHtml(code);
	}
}
