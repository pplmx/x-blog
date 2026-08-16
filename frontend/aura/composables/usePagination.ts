/**
 * Pagination windowing — compute which page numbers to render and where to
 * insert ellipsis, so a large page count doesn't overflow the layout with one
 * button per page.
 *
 * Returns an array of `number | "…"` tokens in display order: the first page,
 * current page ±(maxVisible/2), and the last page, joined by ellipses when
 * gaps exist. A single window block is emitted when the range is small.
 *
 * Pure and framework-free (no Nuxt imports) so it is directly unit-testable.
 */
export function paginationPages(
	totalPages: number,
	currentPage: number,
	maxVisible = 7,
): Array<number | "…"> {
	if (totalPages <= 1) return [];
	const maxWindow = Math.max(5, maxVisible);
	const tokens: Array<number | "…"> = [];

	const addRange = (from: number, to: number) => {
		for (let i = from; i <= to; i++) tokens.push(i);
	};
	const addEllipsis = (gap: number) => {
		if (gap > 1) tokens.push("…");
	};

	const clamp = Math.min(Math.max(currentPage, 1), totalPages);
	// Sliding window centered on the current page, trimmed to [1, totalPages].
	let start = Math.max(1, clamp - Math.floor(maxWindow / 2));
	const end = Math.min(totalPages, start + maxWindow - 1);
	start = Math.max(1, end - maxWindow + 1);

	if (start > 1) {
		tokens.push(1);
		addEllipsis(start - 1);
	}
	addRange(start, end);
	if (end < totalPages) {
		addEllipsis(totalPages - end);
		tokens.push(totalPages);
	}
	return tokens;
}
