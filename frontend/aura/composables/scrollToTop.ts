/**
 * Scroll the window back to the top after a pagination navigation.
 *
 * Paging from the bottom of a list swaps the new page's content in place; if
 * the reader stays scrolled down the swap looks like "nothing happened" while
 * the content changed off-screen. The home feed established this behaviour for
 * its own pagination — this is the shared helper so the archive/search/
 * category/tag lists stay consistent. No-op on the server (no window).
 */
export function scrollToPageTop(): void {
	if (typeof window === "undefined") return;
	window.scrollTo({ top: 0, behavior: "smooth" });
}
