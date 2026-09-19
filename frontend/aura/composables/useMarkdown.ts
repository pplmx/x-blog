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

import type { TokenizerAndRendererExtension, Tokens } from "marked";
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
			// Keep the raw inline capture: its leading/trailing whitespace is the
			// corruption telltale ("$5 to $" pairs two unrelated dollars across a
			// space), and .trim() below would scrub it away.
			const rawInline = inlineFormula ?? "";
			const formula = (displayFormula ?? inlineFormula ?? "").trim();
			if (!formula) return _match;
			// Guard against prose with dollar signs (prices, shell vars):
			// "原价 $5，现价 $10" must not become math "5，现价", and backtick
			// code/English prose like "`$PATH $HOME`" or "costs $5 to $10" must
			// not become "PATH " / "5 to " (the regex pairs the first two `$`s
			// it finds). First signal: the raw capture is bounded by whitespace
			// — the two `$` were never meant to pair. Second: a real formula
			// starts and ends with a letter, digit, backslash (LaTeX command
			// opener) or a closing brace, so fragments like "5–" (a price
			// range) are not math either.
			if (inlineFormula !== undefined) {
				if (/^\s|\s$/.test(rawInline)) return _match;
				if (!/^[A-Za-z0-9\\]/.test(formula) || !/[A-Za-z0-9\\}]$/.test(formula)) {
					return _match;
				}
				// Reject inline formulas that contain CJK characters outside
				// \text{...} groups (legitimate formulas use \text{中文}).
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

/**
 * Extracts images as segments (enables lazy + lightbox rendering, DEC-302):
 * BOTH markdown syntax (`![alt](src)` — how posts are authored) and raw HTML
 * `<img ...>` tags (posts whose content arrives pre-rendered). Markdown images
 * are pre-empted with placeholder comments before `marked` runs, exactly like
 * code fences/math — otherwise marked turns them into an `<img>` inside an
 * HTML chunk where they escape lazy-loading AND the lightbox.
 */
function extractImages(
	content: string,
	keygen: { v: number },
): { segments: Segment[]; processed: string } {
	// A <figure> wraps its <img> WITH a <figcaption>: extracting just the <img>
	// would leave an empty box + a detached image + an orphaned caption. Keep
	// figure blocks intact so the image renders inside its caption (plain img,
	// no lazy-load, but correctly associated). Stash + restore via unbreakable
	// markers so their inner <img> also never trips the segment extraction.
	const figures: string[] = [];
	const stashed = content.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, (fig) => {
		figures.push(fig);
		return `<!--figure:${figures.length - 1}-->`;
	});

	const segments: Segment[] = [];
	// Inline code spans (`` `code` ``) are stashed so a post documenting
	// markdown — `` `![a](/x.png)` `` inside backticks — is never hijacked
	// into a real image. Same rationale as mermaid/code/math running first (a
	// later pass must not mangle their syntax). Restored at the end, before
	// marked runs, so backtick code still renders as code.
	const inlineCodes: string[] = [];
	const codeStashed = stashed.replace(/`+[^`\n]*`+/g, (code) => {
		inlineCodes.push(code);
		return `<!--ic:${inlineCodes.length - 1}-->`;
	});

	// Markdown `![alt](src)` images. LINEAR-time scanning: the alternation
	// either matches a complete image or consumes the `![` prefix via the
	// `[^\]]*` fallback, so a run of unterminated `![` is scanned once rather
	// than once per start position (a quadratic regex on an unbounded post
	// body hangs SSR — this runs on every post render). Balanced inner parens
	// are kept in the src (`path_(x).png`); an optional `(src "title")` is
	// dropped from the URL; a backslash-escaped `\!` stays literal.
	const processed = codeStashed
		.replace(
			/(?<!\\)!\[(?:[^\]]*\]\(((?:[^()\s]|\([^()]*\))*)(?:\s+[^)]*)?\)|[^\]]*)/g,
			(_match, src: string | undefined) => {
				if (src === undefined) return _match; // plain `![` fragment — not an image
				const altStart = _match.indexOf("[") + 1;
				const alt = _match.slice(altStart, _match.indexOf("]", altStart));
				const key = makeKey("image", keygen);
				segments.push({ type: "image", src, alt: alt.trim(), key });
				return `<!--image:${key}-->`;
			},
		)
		.replace(/<img\s+([^>]*?)>/gi, (_match, attrs: string) => {
			const srcMatch = attrs.match(/src\s*=\s*"([^"]*)"/);
			const altMatch = attrs.match(/alt\s*=\s*"([^"]*)"/);
			if (!srcMatch) return _match; // leave intact if no src
			const src = srcMatch[1] ?? "";
			const alt = altMatch ? (altMatch[1] ?? "") : "";
			const key = makeKey("image", keygen);
			segments.push({ type: "image", src, alt, key });
			return `<!--image:${key}-->`;
		})
		.replace(/<!--ic:(\d+)-->/g, (_m, i: string) => inlineCodes[Number(i)] ?? _m)
		.replace(/<!--figure:(\d+)-->/g, (_m, i: string) => figures[Number(i)] ?? "");
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

// --- GFM inline footnotes (DEC-441, TASK-451) ---
//
// marked v16 has no footnote support, so an author's `[^1]`/`[^1]: ...`
// citation markers rendered as LITERAL text in the post body, print route,
// admin preview and (backend) RSS feeds. Two extensions fix every surface at
// once: an inline tokenizer emits a `<sup>` reference that jumps down to the
// definition list; a block tokenizer collects the `[^label]: source` lines and
// renders them as a backlinked ordered list. Registered before any reference
// syntax is resolved so `[^1]: ` is consumed as a footnote definition rather
// than a markdown link-reference (the GFM footnote == link-ref ambiguity).
//
// The definition body is passed back through marked (parseInline) so common
// inline markdown (bold, links) keeps working inside a footnote. Labels can be
// any non-whitespace `\S+` string like GFM (numeric 1/2/3 or word labels).
const FOOTNOTE_CONTAINER_CLASS = "footnotes";

interface FootnoteDefinition {
	label: string;
	text: string;
}

const inlineFootnoteExtension: TokenizerAndRendererExtension = {
	name: "xblogFootnoteRef",
	level: "inline",
	// NOTE: no `start` hint here. marked's inline loop tries every extension
	// tokenizer at each position BEFORE the text rule, so the anchored
	// /^\[\^/ tokenizer below is reached exactly when the marker appears. A
	// `start` that scans with src.indexOf would be called on the WHOLE
	// remaining source at every loop position — O(n²) on a 40KB run that
	// contains no `[^` (the "scans unterminated ![" linearity test catches
	// exactly this hang).
	tokenizer(src: string): { type: string; raw: string; label: string } | undefined {
		const match = /^\[\^([^\]]+)\]/.exec(src);
		if (!match) return undefined;
		// A fully-anchored regex with required groups: when exec succeeds the
		// whole match (index 0) and the label group (index 1) cannot be
		// undefined — the nullish fallbacks only satisfy the index-access types.
		const [raw, label] = match;
		return { type: "xblogFootnoteRef", raw: raw ?? "", label: label ?? "" };
	},
	renderer(token: Tokens.Generic): string {
		const label = String(token.label);
		return `<sup><a href="#fn:${label}" id="fnref:${label}" class="footnote-ref">${label}</a></sup>`;
	},
};

const blockFootnoteExtension: TokenizerAndRendererExtension = {
	name: "xblogFootnoteDefs",
	level: "block",
	start(src: string): number {
		// Only engage at the start of a definition line (`[^label]:`).
		return /^\[\^\S+\]:/.test(src) ? 0 : -1;
	},
	tokenizer(src: string): { type: string; raw: string; defs: FootnoteDefinition[] } | undefined {
		// Collect one or more consecutive `[^label]: text` lines. Definitions
		// share the paragraph block; a real markdown definition leaves the
		// rest of the source untouched for subsequent block tokens.
		const lines = src.split(/\n+/);
		const defs: FootnoteDefinition[] = [];
		let consumed = 0;
		for (const line of lines) {
			const match = /^\[\^(\S+)\]:\s*(.*)$/.exec(line);
			if (!match) break;
			// Same reasoning as the inline tokenizer: both capture groups are
			// required by the fully-anchored pattern, so the nullish fallbacks
			// are type-only (the regex can never match with an empty group).
			const [, label, text] = match;
			defs.push({ label: label ?? "", text: text ?? "" });
			consumed += 1;
		}
		if (defs.length === 0) return undefined;
		return {
			type: "xblogFootnoteDefs",
			raw: `${lines.slice(0, consumed).join("\n")}\n`,
			defs,
		};
	},
	renderer(token: Tokens.Generic): string {
		// Re-parsing the definition body through marked.parseInline lets common
		// inline markdown (bold, links, code) keep working inside a footnote.
		// (this.parser.parseInline expects token arrays, not the raw text —
		// the module-level parseInline takes a string and re-lexes.)
		const items = ((token.defs as FootnoteDefinition[] | undefined) ?? [])
			.map((def: FootnoteDefinition) => {
				const body = String(marked.parseInline(def.text || ""));
				return (
					`<li id="fn:${def.label}"><p>${body}&nbsp;` +
					`<a href="#fnref:${def.label}" class="footnote-backref">↩</a></p></li>`
				);
			})
			.join("\n");
		return `<div class="${FOOTNOTE_CONTAINER_CLASS}"><hr /><ol>\n${items}\n</ol></div>`;
	},
};

marked.use({
	renderer: headingRenderer,
	extensions: [inlineFootnoteExtension, blockFootnoteExtension],
});

/**
 * Convert remaining Markdown (headings, lists, tables, bold, etc.) to HTML.
 * Uses `marked` which is imported statically (available for synchronous use).
 *
 * HTML comments pass through marked verbatim (inline and as blocks) — confirmed
 * by test ("preserves HTML comments through the markdown pipeline"). The old
 * "wrap comments in a placeholder so marked doesn't touch them" wrapper was
 * dead for years: its placeholder constant was an empty string, so both
 * replaces were no-ops. Removed rather than resurrected, since a NUL-wrap would
 * have shoved comments inside <p> instead of letting them stay block-level.
 *
 * NOTE: this helper does NOT reset the duplicate-heading counter — ownership
 * lives with the document-level caller. `useMarkdown` resets once per post so
 * ids stay globally unique ACROSS its html segments (else the same heading text
 * in two segments collides on duplicated DOM ids and TOC anchors); the
 * standalone `markdownToHtml` resets at its own entry. (TOC-anchor bug)
 */
function convertMarkdownToHtml(md: string): string {
	try {
		return String(marked.parse(md));
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
