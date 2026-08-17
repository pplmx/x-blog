/**
 * Dynamic Cover Image Generator for X-Blog.
 *
 * Generates PNG cover images (800x450) with algorithmic gradient color blocks
 * and proper Chinese font support (Noto Sans SC). Uses satori for SVG rendering
 * and sharp for SVG→PNG conversion.
 *
 * @example
 *   /api/cover?title=测试文章
 *   /api/cover?title=Hello+World
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import satori from "satori";
import sharp from "sharp";

import { clientRateIp } from "../../utils/clientIp";

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

// ─── Algorithmic color generation ────────────────────────────────────

/** Algorithmically generate a beautiful gradient color scheme from a title hash. */
function generateColorScheme(title: string): { start: string; end: string } {
	// Pre-defined beautiful color palette
	const palettes = [
		["#3b82f6", "#6366f1"], // blue → indigo
		["#10b981", "#0d9488"], // emerald → teal
		["#8b5cf6", "#7c3aed"], // purple → violet
		["#f59e0b", "#d97706"], // amber → orange
		["#ef4444", "#dc2626"], // red → red-700
		["#06b6d4", "#0284c7"], // cyan → blue-700
		["#84cc16", "#65a30d"], // lime → green-700
		["#f97316", "#ea580c"], // orange → orange-600
		["#ec4899", "#db2777"], // pink → pink-700
		["#1e40af", "#1e3a8a"], // blue-800 → blue-900
	];

	// Hash the title to select a palette
	let hash = 0;
	for (const char of title) {
		hash = (hash * 31 + char.charCodeAt(0)) | 0;
	}
	const index = Math.abs(hash) % palettes.length;
	const palette = palettes[index] ?? palettes[0];
	return { start: palette?.[0] ?? "#3b82f6", end: palette?.[1] ?? "#6366f1" };
}

// ─── SVG template ─────────────────────────────────────────────────────

interface CoverTemplateProps {
	title: string;
	site?: string;
}

/**
 * SVG template with a gradient color block background and centered title.
 * Simple and clean design — algorithmic color selection based on title hash.
 */
function coverTemplate(props: CoverTemplateProps): string {
	const { title, site = "X-Blog" } = props;
	const colors = generateColorScheme(title);

	return `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.start}" />
      <stop offset="100%" stop-color="${colors.end}" />
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#bg)" />
  <foreignObject x="0" y="0" width="800" height="450">
    <div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 60px; box-sizing: border-box; text-align: center; color: white; font-family: 'Noto Sans SC', sans-serif;">
      <h1 style="font-size: 42px; font-weight: 700; line-height: 1.3; margin: 0 0 24px 0; word-break: break-word; max-height: 260px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;">
        ${title}
      </h1>
      <div style="display: flex; align-items: center; gap: 8px; opacity: 0.85;">
        <span style="font-size: 16px; font-weight: 500;">${site}</span>
        <span style="width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,0.5);" />
        <span style="font-size: 14px;">技术博客</span>
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
	if (isRateLimited(`cover:${clientRateIp(event)}`, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW_MS)) {
		throw createError({ statusCode: 429, statusMessage: "Too many requests" });
	}

	const query = getQuery(event);
	const title = typeof query.title === "string" ? query.title : undefined;
	const site = typeof query.site === "string" ? query.site : "X-Blog";

	// Cache for 6 hours (21600 seconds) - covers don't change often
	event.res.setHeader("Cache-Control", "public, max-age=21600, stale-while-revalidate=43200");
	event.res.setHeader("CDN-Cache-Control", "public, max-age=21600");

	// Sanitize + XML-escape before the title reaches the SVG template:
	// raw input could inject arbitrary SVG markup into the generated image
	// or break satori's parser (issue #20).
	const displayTitle = escapeXml(
		sanitizeImageTitle(title && title.length > 0 ? title : "X-Blog — 一个现代化的技术博客系统"),
	);
	const escapedSite = escapeXml(site);

	try {
		// Generate SVG with satori
		const svg = await satori(coverTemplate({ title: displayTitle, site: escapedSite }), {
			width: 800,
			height: 450,
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
		console.error("Cover image generation failed:", error);

		// Fallback: generate a simple PNG directly (no font dependency)
		const fallbackSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <rect width="800" height="450" fill="#3b82f6" />
  <foreignObject x="0" y="0" width="800" height="450">
    <div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: white; font-family: sans-serif; text-align: center; padding: 40px; box-sizing: border-box;">
      <span style="font-size: 36px; font-weight: 700; margin-bottom: 24px; max-width: 90%;">${displayTitle}</span>
      <span style="font-size: 20px; opacity: 0.8;">X-Blog</span>
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
				statusMessage: "Failed to generate cover image",
			});
		}
	}
});
