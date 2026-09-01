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

// Per-document running count so repeated heading text gets GitHub-style -1/-2
// suffixes instead of duplicate id="" anchors (invalid HTML, and every later
// TOC entry would scroll to the FIRST occurrence). Shared with useMarkdown.ts
// so the id the renderer writes into the HTML and the id extractToc derives
// stay in lockstep.
const seenHeadingIds = new Map<string, number>();

/** Reset the duplicate-heading counter at the start of a document. */
export function beginHeadingIds(): void {
	seenHeadingIds.clear();
}

/**
 * Unique per-document heading id for raw heading text.
 *
 * First occurrence of a slug keeps its bare form; repeats get ``-1``, ``-2``,
 * ... in document order (GitHub behavior). A purely-symbol heading that
 * slugifies to "" is left empty (as before) and never collides.
 */
export function uniqueHeadingId(text: string): string {
	const base = slugify(text);
	if (!base) return base;
	const used = seenHeadingIds.get(base) ?? 0;
	seenHeadingIds.set(base, used + 1);
	return used === 0 ? base : `${base}-${used}`;
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
	// duplicate(-1/-2) suffixing is per-document: reset before walking so a
	// fresh page never inherits counters from the previous post.
	beginHeadingIds();
	const toc: TocItem[] = [];

	html.replace(
		/<h([1-6])[^>]*>(.*?)<\/h([1-6])>/gi,
		(_fullMatch, openLevel: string, rawText: string) => {
			const level = Number.parseInt(openLevel, 10);
			// Strip HTML tags from the heading text
			const text = rawText.replace(/<[^>]+>/g, "").trim();

			if (text) {
				const id = uniqueHeadingId(text);
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
