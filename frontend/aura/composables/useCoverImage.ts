/**
 * Shared cover image generation utilities.
 *
 * Provides algorithmic SVG data URI generation from a title hash —
 * no HTTP request needed for on-page display.
 *
 * For OpenGraph / social sharing images, use `buildCoverImageUrl` from
 * `useSeo.ts` instead (social crawlers cannot evaluate inline data URIs).
 */

/** Convert HSL to hex color. All args in degrees/percentages. */
function hslToHex(h: number, s: number, l: number): string {
	h = ((h % 360) + 360) % 360;
	s = Math.max(0, Math.min(100, s)) / 100;
	l = Math.max(0, Math.min(100, l)) / 100;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] =
		h < 60 ? [c, x, 0] :
		h < 120 ? [x, c, 0] :
		h < 180 ? [0, c, x] :
		h < 240 ? [0, x, c] :
		h < 300 ? [x, 0, c] :
		[c, 0, x];
	return `#${Math.round((r + m) * 255).toString(16).padStart(2, "0")}${Math.round((g + m) * 255).toString(16).padStart(2, "0")}${Math.round((b + m) * 255).toString(16).padStart(2, "0")}`;
}

/**
 * Dynamically generate a gradient color scheme from a title hash.
 * Uses the golden ratio (0.618) to distribute hues evenly across the color wheel,
 * with varying saturation (70-95%) and lightness (35-60%) for depth and variety.
 */
function generateColorScheme(title: string): { start: string; end: string } {
	let hash = 0;
	for (const char of title) {
		hash = (hash * 31 + char.charCodeAt(0)) | 0;
	}
	const h = Math.abs(hash);

	const goldenRatio = 0.618033988749895;
	const baseHue = (h % 360 + 360) % 360;
	const endHue = ((baseHue + goldenRatio * 360) % 360 + 360) % 360;

	const baseSat = 70 + (h % 26);
	const endSat = 70 + ((h >> 5) % 26);
	const baseLight = 35 + (h % 26);
	const endLight = 40 + ((h >> 5) % 21);

	return {
		start: hslToHex(baseHue, baseSat, baseLight),
		end: hslToHex(endHue, endSat, endLight),
	};
}

/**
 * Generate an algorithmic cover image as an inline SVG data URI.
 * No HTTP request needed — the browser renders the SVG directly.
 *
 * Uses title hash to dynamically compute HSL colors for infinite variety.
 * For OpenGraph / social sharing images, use `buildCoverImageUrl` from `useSeo.ts`.
 */
export function coverImageSrc(title: string, coverImage?: string): string {
	if (coverImage) return coverImage;

	const colors = generateColorScheme(title);
	const shortTitle = title.length > 28 ? title.slice(0, 28) + "..." : title;

	// Build SVG string and encode once with encodeURIComponent
	const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.start}"/>
      <stop offset="100%" stop-color="${colors.end}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#g)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="36" font-weight="700" font-family="Noto Sans SC, -apple-system, BlinkMacSystemFont, sans-serif" textLength="700" lengthAdjust="spacing_andGlyphs">
    ${shortTitle}
  </text>
</svg>`.trim();

	return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
