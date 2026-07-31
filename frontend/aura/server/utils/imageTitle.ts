/**
 * Sanitizers for the dynamic cover/OG image endpoints (issue #20).
 *
 * The `title`/`site` query params are interpolated into SVG templates and
 * then parsed by satori: unescaped `<`/`&` lets a caller inject arbitrary
 * SVG markup into the generated image, and unbounded input lets one request
 * drive unbounded CPU/memory in satori+sharp.
 */

/** Maximum rendered title length (post titles are capped at 200 too). */
export const MAX_IMAGE_TITLE_LENGTH = 200;

/** Escape a string for safe interpolation into an SVG/XML template. */
export function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

/**
 * Strip characters that are invalid in XML 1.0 — they break satori's parser
 * and would turn a request into a 500.
 */
export function stripInvalidXmlChars(value: string): string {
	let out = "";
	for (const ch of value) {
		const code = ch.charCodeAt(0);
		const valid =
			code === 0x9 ||
			code === 0xa ||
			code === 0xd ||
			(code >= 0x20 && code <= 0xd7ff) ||
			(code >= 0xe000 && code <= 0xfffd) ||
			(code >= 0x10000 && code <= 0x10ffff);
		if (valid) out += ch;
	}
	return out;
}

/** Trim, strip invalid XML chars, and bound the length of a render title. */
export function sanitizeImageTitle(value: string, maxLength = MAX_IMAGE_TITLE_LENGTH): string {
	const stripped = stripInvalidXmlChars(value).trim();
	if (stripped.length <= maxLength) return stripped;
	return `${stripped.slice(0, Math.max(0, maxLength - 1))}…`;
}
