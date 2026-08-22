/**
 * CJK-aware reading time (shared by the post detail page and the print/PDF
 * view so list cards, the detail page, and the print route all agree).
 *
 * Must stay in sync with backend crud.reading_minutes (schemas.py): whitespace
 * tokens plus each CJK char count as one word (~200wpm); a Chinese post with no
 * spaces is not collapsed to a 1-minute read (RIL round 72, ISS-051).
 */
const READING_CJK_RE = /[\u2e80-\u2eff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

/**
 * Returns the estimated reading time in whole minutes (minimum 1).
 * Accepts raw markdown content.
 */
export function readingMinutes(content: string | null | undefined): number {
	if (!content) return 1;
	const tokens = content
		.replace(/[#*`\n]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
	let cjkChars = 0;
	let nonCjkWords = 0;
	for (const token of tokens) {
		const m = token.match(READING_CJK_RE);
		if (m) cjkChars += m.length;
		else nonCjkWords += 1;
	}
	const words = nonCjkWords + cjkChars;
	return Math.max(1, Math.round(words / 200));
}
