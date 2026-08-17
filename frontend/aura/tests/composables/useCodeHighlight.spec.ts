/**
 * useCodeHighlight composable tests.
 *
 * Uses the REAL highlight.js module (not mocked) so escaping and token
 * behaviour are exercised against the actual library. This is safe because
 * highlight.js does not require a DOM, and `loadHighlighter` only resolves
 * client-side.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	escapeHtml,
	type Highlighter,
	highlightCode,
	loadHighlighter,
} from "../../composables/useCodeHighlight";

describe("escapeHtml", () => {
	it("escapes HTML special characters", () => {
		const html = "<script>alert('x')</script> & \"q\"";
		expect(escapeHtml(html)).toBe(
			"&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;q&quot;",
		);
	});
});

describe("highlightCode", () => {
	let h: Highlighter | null = null;

	beforeEach(async () => {
		h = await loadHighlighter();
	});

	afterEach(() => {
		h = null;
	});

	it("loads a highlight.js instance from the common language bundle", () => {
		expect(h).toBeTruthy();
	});

	it("produces hljs token spans for a recognized language", () => {
		expect(h).toBeTruthy();
		const html = highlightCode(h, "javascript", "const x = 42;");
		expect(html).toContain('class="hljs-keyword"');
		expect(html).toContain('class="hljs-number"');
	});

	it("returns safe escaped HTML and escapes script in highlighted output", () => {
		expect(h).toBeTruthy();
		const html = highlightCode(h, "javascript", 'const s = "<script>alert(1)</script>";');
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("</script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("returns escaped plain text for unknown languages", () => {
		const html = highlightCode(h, "definitely-not-a-language", "<b>raw</b>");
		expect(html).toBe("&lt;b&gt;raw&lt;/b&gt;");
	});

	it("returns escaped plain text for plaintext aliases", () => {
		for (const lang of ["", "text", "plaintext", "txt", "plain", "none"]) {
			expect(highlightCode(h, lang, "<x>")).toBe("&lt;x&gt;");
		}
	});

	it("returns escaped plain text when the highlighter is unavailable", () => {
		expect(highlightCode(null, "javascript", "<img>")).toBe("&lt;img&gt;");
	});

	it("normalizes language case", () => {
		expect(h).toBeTruthy();
		const upper = highlightCode(h, "JavaScript", "const x = 1;");
		const lower = highlightCode(h, "javascript", "const x = 1;");
		expect(upper).toBe(lower);
	});

	it("caches the highlighter promise across loads", async () => {
		const first = await loadHighlighter();
		const second = await loadHighlighter();
		expect(first).toBe(second);
	});
});
