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
 * Matches GitHub's algorithm for heading IDs.
 */
function slugify(text: string): string {
	return (
		text
			.toLowerCase()
			.trim()
			.replace(/[\s_]+/g, "-")
			.replace(/[^\w-]+/g, "") || `heading-${Math.random().toString(36).slice(2, 8)}`
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

	html.replace(/<h([1-6])[^>]*>(.*?)<\/h([1-6])>/gi, (_fullMatch, openLevel: string, rawText: string) => {
		const level = Number.parseInt(openLevel, 10);
		// Strip HTML tags from the heading text
		const text = rawText.replace(/<[^>]+>/g, "").trim();

		if (text) {
			const id = slugify(text);
			toc.push({ id, level, text });
		}
		return _fullMatch;
	});

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
