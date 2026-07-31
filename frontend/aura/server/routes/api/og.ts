/**
 * Dynamic OG Image Generator for X-Blog.
 *
 * Generates PNG images (1200x630) for Open Graph / social sharing with
 * proper Chinese font support (Noto Sans SC). Uses satori for SVG rendering
 * and sharp for SVG→PNG conversion.
 *
 * @example
 *   /api/og?title=测试文章
 *   /api/og?title=Hello World&type=website
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import satori from "satori";
import sharp from "sharp";

// ─── Font loading ─────────────────────────────────────────────────────

/** Path to the Noto Sans SC font bundled in the project. */
const FONT_PATH = join(process.cwd(), "assets/fonts/NotoSansSC-Regular.otf");

let _fontBuffer: Buffer | null = null;

/** Lazily load the font buffer (so module import doesn't fail during build). */
function getFontBuffer(): Buffer {
	if (_fontBuffer) return _fontBuffer;
	try {
		_fontBuffer = readFileSync(FONT_PATH);
	} catch {
		// Fallback: if the font file is missing, satori will use its default
		// font which still renders Latin characters correctly.
		_fontBuffer = Buffer.alloc(0);
	}
	return _fontBuffer;
}

// ─── SVG template ─────────────────────────────────────────────────────

interface OgTemplateProps {
	title: string;
	site?: string;
	type?: "article" | "website";
}

/**
 * SVG template with a gradient background and two-column layout.
 * Left column: title (wraps automatically). Right column: site name badge.
 */
function ogTemplate(props: OgTemplateProps): string {
	const { title, site = "X-Blog", type = "article" } = props;

	// Gradient background: blue → indigo → purple (matching PostCard.vue)
	const gradients = [
		"from-blue-500 to-indigo-600",
		"from-purple-500 to-pink-600",
		"from-cyan-500 to-blue-600",
		"from-emerald-500 to-teal-600",
		"from-orange-500 to-red-600",
	];
	const hash = title.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
	const gradientClasses = gradients[hash % gradients.length];

	// Convert gradient class to actual SVG gradient
	const gradientMap = {
		"from-blue-500 to-indigo-600": ["#3b82f6", "#6366f1"],
		"from-purple-500 to-pink-600": ["#a855f7", "#ec4899"],
		"from-cyan-500 to-blue-600": ["#06b6d4", "#2563eb"],
		"from-emerald-500 to-teal-600": ["#10b981", "#0d9488"],
		"from-orange-500 to-red-600": ["#f97316", "#ef4444"],
	} as const;
	const [startColor, endColor] = (gradientClasses &&
		gradientMap[gradientClasses as keyof typeof gradientMap]) || ["#3b82f6", "#6366f1"];

	return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${startColor}" />
      <stop offset="100%" stop-color="${endColor}" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg-gradient)" />
  <foreignObject x="0" y="0" width="1200" height="630">
    <div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 80px; box-sizing: border-box; color: white; font-family: 'Noto Sans SC', sans-serif;">
      <span style="font-size: 24px; opacity: 0.9; font-weight: 400; margin-bottom: 32px;">${type === "article" ? "技术文章" : "X-Blog"}</span>
      <h1 style="font-size: 56px; font-weight: 700; line-height: 1.2; margin: 0 0 40px 0; word-break: break-word;">${title}</h1>
      <div style="display: flex; align-items: center; gap: 16px;">
        <span style="font-size: 16px; opacity: 0.8; font-weight: 300;">${site}</span>
      </div>
    </div>
  </foreignObject>
</svg>
`;
}

// ─── Handler ──────────────────────────────────────────────────────────

// Public, unauthenticated, CPU-heavy rendering (satori + sharp) — bound
// volume per IP so one caller cannot pin the server (issue #20).
const IMAGE_RATE_LIMIT = 30; // requests
const IMAGE_RATE_WINDOW_MS = 60_000; // per IP per window

export default defineEventHandler(async (event) => {
	if (
		isRateLimited(`og:${getRequestIP(event) ?? "unknown"}`, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW_MS)
	) {
		throw createError({ statusCode: 429, statusMessage: "Too many requests" });
	}

	const query = getQuery(event);
	const title = typeof query.title === "string" ? query.title : undefined;
	const site = typeof query.site === "string" ? query.site : "X-Blog";
	const type = query.type === "website" ? "website" : "article";

	// Cache for 1 hour (3600 seconds)
	event.res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
	event.res.setHeader("CDN-Cache-Control", "public, max-age=3600");

	// Sanitize + XML-escape before the title reaches the SVG template:
	// raw input could inject arbitrary SVG markup into the generated image
	// or break satori's parser (issue #20).
	const displayTitle = escapeXml(
		sanitizeImageTitle(title && title.length > 0 ? title : "X-Blog — 一个现代化的技术博客系统"),
	);
	const escapedSite = escapeXml(site);

	try {
		// Generate SVG with satori
		const svg = await satori(ogTemplate({ title: displayTitle, site: escapedSite, type }), {
			width: 1200,
			height: 630,
			fonts: [
				{
					name: "Noto Sans SC",
					data: getFontBuffer(),
					weight: 400,
					style: "normal",
				},
			],
		});

		// Convert SVG to PNG with sharp
		const png = await sharp(Buffer.from(svg)).png().toBuffer();

		event.res.setHeader("Content-Type", "image/png");
		event.res.setHeader("Content-Length", png.length.toString());
		return png;
	} catch (error) {
		console.error("OG image generation failed:", error);

		// Fallback: generate a simple SVG directly (no font dependency)
		const fallbackSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#1e293b" />
  <foreignObject x="0" y="0" width="1200" height="630">
    <div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; color: white; font-family: sans-serif; text-align: center; padding: 40px; box-sizing: border-box;">
      <span style="font-size: 48px; font-weight: 700; margin-bottom: 24px;">${displayTitle}</span>
      <span style="font-size: 24px; opacity: 0.8;">X-Blog</span>
    </div>
  </foreignObject>
</svg>
`;

		try {
			const fallbackPng = await sharp(Buffer.from(fallbackSvg)).png().toBuffer();
			event.res.setHeader("Content-Type", "image/png");
			event.res.setHeader("Content-Length", fallbackPng.length.toString());
			return fallbackPng;
		} catch {
			throw createError({
				statusCode: 500,
				statusMessage: "Failed to generate OG image",
			});
		}
	}
});
