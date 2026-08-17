import { computed } from "vue";

/**
 * Table of Contents (TOC) composable for Nuxt.
 *
 * Extracts heading elements (h1-h6) from HTML content string and returns
 * a structured list of TOC items with id, level, and text.
 *
 * Usage in a page/component:
 *   const { toc } = useToc(postContent);
 *
 * The extracted headings should have matching IDs in the rendered HTML
 * so that anchor links (href="#heading-id") work for smooth scrolling.
 */

export interface TocItem {
	id: string;
	level: number;
	text: string;
}

/**
 * Generate a URL-safe slug from heading text.
 * Matches GitHub's algorithm for heading IDs, extended to preserve CJK and
 * accented letters (GitHub keeps them; the ASCII-only `\w` collapsed a Chinese
 * heading like `# 中文标题` to `""`, producing empty `id=""` anchors, dead TOC
 * links and duplicate v-for keys — a real bug on this Chinese-language blog).
 *
 * Shared with useMarkdown.ts, whose marked renderer emits these ids on the
 * rendered headings — the TOC anchors only resolve because both sides use
 * this exact function.
 */
export function slugify(text: string): string {
	return (
		text
			.toLowerCase()
			.trim()
			.replace(/[\s_]+/g, "-")
			// Keep any Unicode letter/number (incl. CJK) plus hyphen; drop
			// symbols/punctuation (`,.?!#%` etc). The `u` flag enables
			// \p{L}/\p{N}. Trailing.replace yields "" only for pure-symbol text.
			.replace(/[^\p{L}\p{N}-]+/gu, "")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "") || ""
	);
}

/**
 * Extract TOC items from HTML content.
 * Returns an array of { id, level, text } for each heading found.
 */
export function extractToc(html: string): TocItem[] {
	if (!html) return [];

	// Use a simple regex to find all heading tags. Using String.replace
	// with a callback avoids both manual RegExp.exec loop state and the
	// esbuild 0.28.1 transpilation bug with exec+while patterns.
	const toc: TocItem[] = [];

	html.replace(
		/<h([1-6])[^>]*>(.*?)<\/h([1-6])>/gi,
		(_fullMatch, openLevel: string, rawText: string) => {
			const level = Number.parseInt(openLevel, 10);
			// Strip HTML tags from the heading text
			const text = rawText.replace(/<[^>]+>/g, "").trim();

			if (text) {
				const id = slugify(text);
				toc.push({ id, level, text });
			}
			return _fullMatch;
		},
	);

	return toc;
}

/**
 * Composable that returns TOC items for the given HTML content.
 * @param html The HTML content string (reactive ref or plain string)
 */
export function useToc(html: string | { value: string }) {
	const content = typeof html === "string" ? html : html.value;
	const toc = computed(() => extractToc(content));
	return { toc };
}
