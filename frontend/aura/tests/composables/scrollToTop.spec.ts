/**
 * scrollToPageTop — the shared "pagination returns the reader to the top"
 * behaviour used by archive/search/category/tag feeds (matching the home feed).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollToPageTop } from "../../composables/scrollToTop";

describe("scrollToPageTop", () => {
	let scrollToSpy: ReturnType<typeof vi.fn>;

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("smooth-scrolls the window to the top on the client", () => {
		scrollToSpy = vi.fn();
		vi.stubGlobal("window", { scrollTo: scrollToSpy } as unknown as Window);
		scrollToPageTop();
		expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
	});

	it("is a safe no-op when window is unavailable (SSR)", () => {
		// The composable must not blow up where there is no window (server-side
		// render) — call it as though `window` were undefined.
		const originalWindow = globalThis.window;
		// @ts-expect-error - simulating an SSR environment for this branch
		delete globalThis.window;
		expect(() => scrollToPageTop()).not.toThrow();
		globalThis.window = originalWindow;
	});
});
