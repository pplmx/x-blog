/**
 * Markdown content processing composable for Nuxt.
 *
 * Converts any remaining Markdown (headings, lists, tables, bold, etc.) to HTML
 * using the `marked` library before splitting into segments, so that Markdown
 * content stored by the backend renders correctly. Code blocks, images, math,
 * and mermaid blocks are extracted as segments before Markdown conversion so
 * their internal syntax is not affected by the Markdown-to-HTML step.
 *
 * Segments look like:
 *   { type: 'html',   html: '<p>...</p>' }
 *   { type: 'code',   lang: 'ts', code: '...' }
 *   { type: 'mermaid', code: '...' }
 *   { type: 'math',   formula: '...', displayMode: true }
 *   { type: 'image',  src: '...', alt: '...' }
 *
 * Usage:
 *   const { segments } = useMarkdown(postContent);
 */

import { marked } from "marked";

import { slugify } from "./useToc";

export type Segment =
	| { type: "html"; html: string; key: string }
	| { type: "code"; lang: string; code: string; key: string }
	| { type: "mermaid"; code: string; key: string }
	| { type: "math"; formula: string; displayMode: boolean; key: string }
	| { type: "image"; src: string; alt: string; key: string };

export interface UseMarkdownResult {
	segments: Segment[];
}

// --- URL Sanitisation (kept inline for SSR friendliness) ---

const ALLOWED_SCHEMES = ["https:", "http:", "mailto:"];

export function sanitizeUrl(href: string, hostname = ""): string {
	if (!href) return "#";
	// Relative URLs without a scheme are passed through (same-origin).
	// Absolute URLs are whitelisted by scheme and hostname.
	try {
		// If the string doesn't look absolute, treat as relative.
		if (!href.match(/^[a-z][a-z0-9+.-]*:/i)) {
			return href;
		}
		const url = new URL(href);
		if (!ALLOWED_SCHEMES.includes(url.protocol)) return "#";
		if (hostname && url.hostname !== hostname) return "#";
		return url.href;
	} catch {
		return "#";
	}
}

// --- Placeholder counters (stable across calls for a single content) ---

function makeKey(prefix: string, counter: { v: number }): string {
	counter.v += 1;
	return `${prefix}-${counter.v}`;
}

// --- Regex helpers ---

/** Extracts ```mermaid ... ``` blocks as segments, replacing with placeholder comments. */
function extractMermaid(
	content: string,
	keygen: { v: number },
): { segments: Segment[]; processed: string } {
	const segments: Segment[] = [];
	const processed = content.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_match, code: string) => {
		const key = makeKey("mermaid", keygen);
		segments.push({ type: "mermaid", code: code.trim(), key });
		return `<!--mermaid:${key}-->`;
	});
	return { segments, processed };
}

/**
 * Extracts math formulas ($$...$$ for display mode, $...$ for inline) as segments,
 * replacing with placeholder comments. Must run AFTER code block extraction
 * so that $ characters inside code blocks are not matched as math.
 *
 * The display-mode regex uses [\s\S] instead of . so that $$...$$ spanning
 * multiple lines is correctly matched (.* does not match newlines).
 */
function extractMath(
	content: string,
	keygen: { v: number },
): { segments: Segment[]; processed: string } {
	const segments: Segment[] = [];
	const processed = content.replace(
		/\$\$(\s*[\s\S]*?\s*)\$\$|\$(.*?)\$/g,
		(_match, displayFormula: string | undefined, inlineFormula: string | undefined) => {
			const formula = (displayFormula ?? inlineFormula ?? "").trim();
			if (!formula) return _match;
			// Guard against prose with dollar signs (prices, shell vars):
			// "原价 $5，现价 $10" must not become math "5，现价". Reject inline
			// formulas that contain CJK characters outside \text{...} groups
			// (legitimate formulas use \text{中文} for CJK text).
			if (inlineFormula !== undefined) {
				const withoutTextGroup = formula.replace(/\\text\{[^}]*\}/g, "");
				// CJK range: 一-鿿 (common) + 㐀-䶿 (extended)
				if (/[一-鿿㐀-䶿]/.test(withoutTextGroup)) return _match;
			}
			const key = makeKey("math", keygen);
			segments.push({
				type: "math",
				formula,
				displayMode: displayFormula !== undefined,
				key,
			});
			return `<!--math:${key}-->`;
		},
	);
	return { segments, processed };
}

/** Extracts generic fenced code blocks (non-mermaid) as segments. */
function extractCodeBlocks(
	content: string,
	keygen: { v: number },
): { segments: Segment[]; processed: string } {
	const segments: Segment[] = [];
	const processed = content.replace(
		/```([^\s`]*)\s*\n([\s\S]*?)```/g,
		(_match, lang: string, code: string) => {
			const key = makeKey("code", keygen);
			segments.push({
				type: "code",
				lang: lang || "text",
				code: code.trim(),
				key,
			});
			return `<!--code:${key}-->`;
		},
	);
	return { segments, processed };
}

/** Extracts <img ...> tags as segments (enables lazy + lightbox rendering). */
function extractImages(
	content: string,
	keygen: { v: number },
): { segments: Segment[]; processed: string } {
	const segments: Segment[] = [];
	const processed = content.replace(/<img\s+([^>]*?)>/gi, (_match, attrs: string) => {
		const srcMatch = attrs.match(/src\s*=\s*"([^"]*)"/);
		const altMatch = attrs.match(/alt\s*=\s*"([^"]*)"/);
		if (!srcMatch) return _match; // leave intact if no src
		const src = srcMatch[1] ?? "";
		const alt = altMatch ? (altMatch[1] ?? "") : "";
		const key = makeKey("image", keygen);
		segments.push({ type: "image", src, alt, key });
		return `<!--image:${key}-->`;
	});
	return { segments, processed };
}

// --- DOMPurify (lazy-loaded so SSR doesn't break) ---

let purify: ((html: string) => string) | null = null;

/**
 * Minimal synchronous sanitizer used until DOMPurify finishes loading (and as
 * the permanent fallback in environments where DOMPurify cannot run).
 *
 * Strips script/style/iframe/object/embed/form elements and all on* event
 * handler attributes. This is NOT as strong as DOMPurify (e.g. `javascript:`
 * hrefs and SVG payloads survive), so DOMPurify is always preferred on the
 * client — but the fallback must never be identity: content rendered through
 * v-html must always pass through a sanitizer.
 */
export function regexSanitize(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
		.replace(/<(script|style|iframe|object|embed|form)[^>]*>.*?<\/\1>/gi, "");
}

/** Load DOMPurify (client-side) and verify it actually strips XSS payloads. */
export async function loadPurify(): Promise<void> {
	if (purify) return;
	try {
		const mod = await import("dompurify");
		const DomPurify = mod.default || mod;
		// Verify DOMPurify actually sanitizes by testing with a known XSS payload.
		// In environments like happy-dom (test runner), isSupported may be true
		// but sanitize silently fails to strip <script> tags.
		if (typeof DomPurify?.sanitize === "function") {
			const testResult = DomPurify.sanitize("<script>alert(1)</script>");
			if (typeof testResult === "string" && !testResult.includes("<script>")) {
				purify = (html: string) => DomPurify.sanitize(html);
				return;
			}
		}
	} catch {
		// DOMPurify unavailable (SSR / no DOM) — the regex fallback stays active.
	}
	purify = regexSanitize;
}

/**
 * Synchronous sanitization: DOMPurify when loaded, otherwise the always-active
 * regex fallback. Never identity — v-html consumers rely on this guarantee.
 */
export function sanitizeHtml(html: string): string {
	try {
		return purify ? purify(html) : regexSanitize(html);
	} catch {
		return regexSanitize(html);
	}
}

// --- Markdown-to-HTML conversion (marked) ---

// Markdown heading renderer: emit the same id that useToc.extractToc computes,
// so TOC anchor links resolve to real heading elements.
const headingRenderer = new marked.Renderer();
headingRenderer.heading = function (token: { tokens: unknown[]; depth: number }) {
	const html = String(this.parser.parseInline(token.tokens as never));
	const text = html.replace(/<[^>]+>/g, "").trim();
	return `<h${token.depth} id="${slugify(text)}">${html}</h${token.depth}>`;
};
marked.use({ renderer: headingRenderer });

/**
 * Convert remaining Markdown (headings, lists, tables, bold, etc.) to HTML.
 * Preserves HTML comments (placeholders) by wrapping them so marked doesn't touch them.
 * Uses `marked` which is imported statically (available for synchronous use).
 */
function convertMarkdownToHtml(md: string): string {
	try {
		const placeholder = "";
		const safeMd = md.replace(/(<!--[\s\S]*?-->)/g, `${placeholder}$1${placeholder}`);
		const html = String(marked.parse(safeMd));
		return html.replace(new RegExp(`${placeholder}(<![\\s\\S]*?-->)${placeholder}`, "g"), "$1");
	} catch {
		return md;
	}
}

// --- Main composable ---

export function useMarkdown(content: string): UseMarkdownResult {
	if (!content) return { segments: [] };

	const keygen = { v: 0 };

	// 1. Extract Mermaid blocks (first, so ```mermaid fences aren't treated as code blocks)
	const { segments: mermaidSegs, processed: afterMermaid } = extractMermaid(content, keygen);

	// 2. Extract code blocks (before math so $ inside code is preserved)
	const { segments: codeSegs, processed: afterCode } = extractCodeBlocks(afterMermaid, keygen);

	// 3. Extract math formulas ($$...$$ and $...$) — after code blocks so $ in code is preserved
	const { segments: mathSegs, processed: afterMath } = extractMath(afterCode, keygen);

	// 4. Extract images
	const { segments: imageSegs, processed: afterImages } = extractImages(afterMath, keygen);

	// 5. Build the ordered segment list. Placeholders are `<!--type:key-->` comments.
	//    We walk the processed string and split on these markers.
	const allExtracted = new Map<string, Segment>();
	for (const s of [...mermaidSegs, ...mathSegs, ...codeSegs, ...imageSegs]) {
		allExtracted.set(s.key, s);
	}

	const segments: Segment[] = [];
	// Build the ordered segment list by walking placeholders (`<!--type:key-->`)
	// and emitting HTML chunks between them. Using `String.replace` with a
	// callback avoids manual `RegExp.exec` loop state, which is more robust
	// across transpiler versions.
	const placeholderRegex = /<!--(mermaid|code|image|math):(.+?)-->/g;
	let last = 0;

	afterImages.replace(placeholderRegex, (fullMatch, _type: string, key: string, offset: number) => {
		if (offset > last) {
			const htmlChunk = afterImages.slice(last, offset);
			if (htmlChunk.trim()) {
				segments.push({
					type: "html",
					html: convertMarkdownToHtml(htmlChunk),
					key: makeKey("html", keygen),
				});
			}
		}
		// The key already includes the prefix (e.g., 'code-1'), so look it up directly.
		const seg = allExtracted.get(key);
		if (seg) {
			segments.push(seg);
		}
		last = offset + fullMatch.length;
		return fullMatch;
	});

	// Trailing HTML after the last placeholder
	if (last < afterImages.length) {
		const htmlChunk = afterImages.slice(last);
		if (htmlChunk.trim()) {
			segments.push({
				type: "html",
				html: convertMarkdownToHtml(htmlChunk),
				key: makeKey("html", keygen),
			});
		}
	}

	return { segments };
}

/** Asynchronously sanitise all HTML segments. Call in onBeforeMount for SSR safety. */
export async function useMarkdownSanitised(content: string): Promise<UseMarkdownResult> {
	const result = useMarkdown(content);
	await loadPurify();
	const segments = result.segments.map((s) =>
		s.type === "html" ? { ...s, html: sanitizeHtml(s.html) } : s,
	);
	return { segments };
}
