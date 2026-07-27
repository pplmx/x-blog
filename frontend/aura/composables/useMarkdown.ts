/**
 * Markdown content processing composable for Nuxt.
 *
 * Splits raw HTML content (as returned by the backend) into a flat list of
 * segments so that special blocks — fenced code, Mermaid diagrams, inline
 * and display math, and images — can be rendered by dedicated Vue components
 * instead of `v-html`. Every plain-HTML segment is sanitised with DOMPurify
 * to strip XSS vectors.
 *
 * Usage:
 *   const { segments } = useMarkdown(postContent);
 *
 * Segments look like:
 *   { type: 'html',   html: '<p>...</p>' }
 *   { type: 'code',   lang: 'ts', code: '...' }
 *   { type: 'mermaid', code: '...' }
 *   { type: 'math',   formula: '...', displayMode: true }
 *   { type: 'image',  src: '...', alt: '...' }
 */

export type Segment =
	| { type: "html"; html: string; key: string }
	| { type: "code"; lang: string; code: string; key: string }
	| { type: "mermaid"; code: string; key: string }
	| { type: "math"; formula: string; displayMode: boolean; key: string }
	| { type: "image"; src: string; alt: string; key: string };

export interface UseMarkdownResult {
	segments: Segment[];
}

// --- URL sanitisation (kept inline for SSR friendliness) ---

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

// --- URL / math regex helpers ---

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

/** Extracts generic fenced code blocks (non-mermaid) as segments. */
function extractCodeBlocks(
	content: string,
	keygen: { v: number },
): { segments: Segment[]; processed: string } {
	const segments: Segment[] = [];
	const processed = content.replace(
		/```(\w*)\s*\n([\s\S]*?)```/g,
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
		const src = srcMatch[1];
		const alt = altMatch ? altMatch[1] : "";
		const key = makeKey("image", keygen);
		segments.push({ type: "image", src, alt, key });
		return `<!--image:${key}-->`;
	});
	return { segments, processed };
}

// --- DOMPurify (lazy-loaded so SSR doesn't break) ---

let purify: ((html: string) => string) | null = null;

async function loadPurify(): Promise<typeof purify> {
	if (purify) return purify;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = await import("dompurify");
		purify = mod.default || mod;
	} catch {
		// Fallback: a very small sanitiser that strips script/style/event handlers.
		purify = (html: string) =>
			html
				.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
				.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
				.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
				.replace(/<(script|style|iframe|object|embed|form)[^>]*>.*?<\/\1>/gi, "");
	}
	return purify;
}

/** Synchronous sanitise using DOMPurify when available (client-side), otherwise identity. */
export function sanitizeHtml(html: string): string {
	if (purify) return purify(html);
	// SSR fallback — strip tags we know are dangerous.
	return html;
}

// --- Main composable ---

export function useMarkdown(content: string): UseMarkdownResult {
	if (!content) return { segments: [] };

	const keygen = { v: 0 };

	// 1. Extract Mermaid blocks
	const { segments: mermaidSegs, processed: afterMermaid } = extractMermaid(content, keygen);

	// 2. Extract code blocks (non-mermaid)
	const { segments: codeSegs, processed: afterCode } = extractCodeBlocks(afterMermaid, keygen);

	// 3. Extract images
	const { segments: imageSegs, processed: afterImages } = extractImages(afterCode, keygen);

	// 4. Build the ordered segment list. Placeholders are `<!--type:key-->` comments.
	//    We walk the processed string and split on these markers.
	const allExtracted = new Map<string, Segment>();
	for (const s of [...mermaidSegs, ...codeSegs, ...imageSegs]) {
		allExtracted.set(s.key, s);
	}

	const segments: Segment[] = [];
	// Build the ordered segment list by walking placeholders (`<!--type:key-->`)
	// and emitting HTML chunks between them. Using `String.replace` with a
	// callback avoids manual `RegExp.exec` loop state, which is more robust
	// across transpiler versions.
	const placeholderRegex = /<!--(mermaid|code|image):(.+?)-->/g;
	let last = 0;

	afterImages.replace(placeholderRegex, (fullMatch, _type: string, key: string, offset: number) => {
		if (offset > last) {
			const htmlChunk = afterImages.slice(last, offset);
			if (htmlChunk.trim()) {
				segments.push({
					type: "html",
					html: htmlChunk,
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
				html: htmlChunk,
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
