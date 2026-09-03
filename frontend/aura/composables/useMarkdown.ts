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

import { beginHeadingIds, uniqueHeadingId } from "./useToc";

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

/** URL-typed attribute schemes no sanitizer may ever pass through. */
const UNSAFE_URL_SCHEMES = /^(javascript|vbscript|data):/i;

/**
 * Empty out href/src/action/xlink:href attributes whose value starts with an
 * unsafe scheme (``javascript:``, ``vbscript:``, ``data:``). Runs ALWAYS (even
 * after DOMPurify) because some DOM harnesses fail to enforce DOMPurify's URI
 * whitelist — a ``[x](javascript:...)`` comment must never become a clickable
 * script link in any renderer.
 */
export function stripUnsafeUrlAttrs(html: string): string {
	return html.replace(
		/\s(href|src|action|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
		(match, attr: string, value: string) => {
			const raw = value.replace(/^["']|["']$/g, "").trim();
			return UNSAFE_URL_SCHEMES.test(raw) ? ` ${attr}=""` : match;
		},
	);
}

/**
 * Minimal synchronous sanitizer used until DOMPurify finishes loading (and as
 * the permanent fallback in environments where DOMPurify cannot run).
 *
 * Strips script/style/iframe/object/embed/form elements, all on* event-handler
 * attributes, and nulls href/src/action attributes with an unsafe scheme (via
 * the always-on ``stripUnsafeUrlAttrs``). Still NOT as strong as DOMPurify
 * (e.g. SVG payloads), so DOMPurify is always preferred — but the fallback
 * must never be identity.
 */
export function regexSanitize(html: string): string {
	return stripUnsafeUrlAttrs(
		html
			.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
			.replace(/<(script|style|iframe|object|embed|form)[^>]*>.*?<\/\1>/gi, ""),
	);
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
				// Chain stripUnsafeUrlAttrs even after DOMPurify: some DOM
				// harnesses pass DOMPurify's script/element checks but fail to
				// enforce its URI whitelist, leaving a live javascript: href.
				purify = (html: string) => stripUnsafeUrlAttrs(DomPurify.sanitize(html));
				return;
			}
		}
	} catch {
		// DOMPurify unavailable (SSR / no DOM) — the regex fallback stays active.
	}
	purify = regexSanitize;
}

// --- Link/image attribute hardening (runs AFTER sanitization) ---

/** Read a quoted attribute value (double or single quotes) from a tag's attrs. */
function attrValue(attrs: string, name: string): string | null {
	const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
	return m ? (m[2] ?? m[3] ?? "") : null;
}

/**
 * Harden links/images in sanitized HTML without touching their URLs.
 *
 * Sanitization strips dangerous content but leaves authored markup as-is, so a
 * post/comment link out to the web opens in the SAME tab and raw `<img>` tags
 * can render with no alt text (ISS-221). This serialized pass — no DOM, so it
 * works under SSR and on the regex-fallback path alike — upgrades the output:
 *
 *   - absolute http(s) ``<a>`` links get ``target="_blank"`` and
 *     ``rel="noopener noreferrer"`` (merging with, and deduping against, any
 *     existing rel) so external links open in a fresh tab without granting the
 *     destination a ``window.opener`` (tabnabbing);
 *   - relative/internal/``mailto:`` links, href-less anchors, and any link
 *     where the author already set a target are left untouched;
 *   - ``<img>`` with no alt attribute gets ``alt=""`` (decorative), matching
 *     how MarkdownContent marks its extracted image segments.
 *
 * It only ADDS attributes and never rewrites a URL, so it cannot reintroduce a
 * scheme the sanitizer already nulled.
 */
export function addSafeLinkAttrs(html: string): string {
	return html
		.replace(/<a\b([^>]*)>/gi, (match, attrs: string) => {
			const href = attrValue(attrs, "href");
			if (!href || !/^https?:\/\//i.test(href)) return match;
			if (/\btarget\s*=/i.test(attrs)) return match;
			const tokens = new Set((attrValue(attrs, "rel") ?? "").split(/\s+/).filter(Boolean));
			const extra: string[] = [];
			if (!tokens.has("noopener")) extra.push("noopener");
			if (!tokens.has("noreferrer")) extra.push("noreferrer");
			if (extra.length === 0) return `<a${attrs} target="_blank">`;
			return `<a${attrs} target="_blank" rel="${[...tokens, ...extra].join(" ")}">`;
		})
		.replace(/<img\b([^>]*)>/gi, (match, attrs: string) => {
			if (/\balt\s*=/i.test(attrs)) return match;
			return `<img${attrs} alt="">`;
		});
}

/**
 * Synchronous sanitization: DOMPurify when loaded, otherwise the always-active
 * regex fallback. Never identity — v-html consumers rely on this guarantee.
 * Sanitized output then gets the link/image hardening pass (ISS-221).
 */
export function sanitizeHtml(html: string): string {
	try {
		return purify ? addSafeLinkAttrs(purify(html)) : addSafeLinkAttrs(regexSanitize(html));
	} catch {
		return addSafeLinkAttrs(regexSanitize(html));
	}
}

// --- Markdown-to-HTML conversion (marked) ---

// Markdown heading renderer: emit the same id that useToc.extractToc computes
// (with GitHub-style -1/-2 disambiguation for repeated heading text), so TOC
// anchor links resolve to real, unique heading elements.
const headingRenderer = new marked.Renderer();
headingRenderer.heading = function (token: { tokens: unknown[]; depth: number }) {
	const html = String(this.parser.parseInline(token.tokens as never));
	const text = html.replace(/<[^>]+>/g, "").trim();
	return `<h${token.depth} id="${uniqueHeadingId(text)}">${html}</h${token.depth}>`;
};
marked.use({ renderer: headingRenderer });

/**
 * Convert remaining Markdown (headings, lists, tables, bold, etc.) to HTML.
 * Preserves HTML comments (placeholders) by wrapping them so marked doesn't touch them.
 * Uses `marked` which is imported statically (available for synchronous use).
 */
function convertMarkdownToHtml(md: string): string {
	// NOTE: does NOT reset the duplicate-heading counter — ownership lives with
	// the document-level caller. `useMarkdown` resets once per post so ids stay
	// globally unique ACROSS its html segments (else the same heading text in
	// two segments collides on duplicated DOM ids and TOC anchors); the
	// standalone `markdownToHtml` resets at its own entry. (TOC-anchor bug)
	try {
		const placeholder = "";
		const safeMd = md.replace(/(<!--[\s\S]*?-->)/g, `${placeholder}$1${placeholder}`);
		const html = String(marked.parse(safeMd));
		return html.replace(new RegExp(`${placeholder}(<![\\s\\S]*?-->)${placeholder}`, "g"), "$1");
	} catch {
		return md;
	}
}

/**
 * Convert whole Markdown to HTML using the same heading renderer that
 * `useMarkdown` uses, so rendered headings carry the exact `id` values
 * `extractToc` computes. Feed this HTML to `extractToc` (or render it) so TOC
 * anchors resolve to real heading elements. (RIL TASK-104, ISS-084)
 */
export function markdownToHtml(md: string): string {
	// Standalone whole-document conversion: reset the shared heading counter so
	// the emitted ids are unique across the entire document (previous document's
	// counters can't leak in either).
	beginHeadingIds();
	return convertMarkdownToHtml(md);
}

/**
 * Render comment content as sanitized HTML (DEC-088, TASK-156).
 *
 * Comments reuse the post pipeline (marked) with ``breaks: true`` so single
 * newlines become ``<br>`` (comment prose is line-broken like the old
 * ``whitespace-pre-wrap`` text, unlike post prose). The result is ALWAYS piped
 * through ``sanitizeHtml`` — DOMPurify once loaded, the always-on regex
 * fallback beforehand — so a ``<script>``/event-handler comment can never
 * execute regardless of render timing.
 */
export function commentMarkdownToHtml(md: string): string {
	beginHeadingIds(); // per-document duplicate-heading counter (see convertMarkdownToHtml)
	try {
		const html = String(marked.parse(md || "", { breaks: true }));
		return sanitizeHtml(html);
	} catch {
		return sanitizeHtml(md || "");
	}
}

// --- Main composable ---

export function useMarkdown(content: string): UseMarkdownResult {
	if (!content) return { segments: [] };

	// Per-document reset of the duplicate-heading counter BEFORE segmenting:
	// the same heading text appearing before and after an extracted
	// mermaid/math/code/image block sits in two different html segments, and
	// each segment is rendered independently — a per-segment reset would give
	// both occurrences the SAME bare id (duplicate DOM ids, and the TOC's
	// `-1`-suffixed anchor would point at nothing). Resetting once per document
	// keeps the ids globally unique and in lockstep with extractToc.
	beginHeadingIds();

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
