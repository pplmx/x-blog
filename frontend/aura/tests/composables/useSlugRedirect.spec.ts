/**
 * useSlugRedirect composable tests (round 350).
 *
 * The backend 404s a re-slugged post / series / page with an `X-Redirect-To`
 * header naming the canonical target; this composable turns it into a real 301
 * during SSR or a hard `window.location.replace` in the SPA client. Vitest
 * runs the client branch (`import.meta.server` is falsy here), so these cover
 * the header normalization — reading it off the error's `.cause` (server error
 * shape) or `.response` (client shape) — and the no-op contracts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("nuxt/app", () => ({
	useRequestEvent: () => undefined,
}));

import { useSlugRedirect } from "../../composables/useSlugRedirect";

function headerError(header: string | null) {
	return {
		statusCode: 404,
		// Server error shape: original ofetch FetchError buried in `.cause`.
		cause: { response: { headers: { get: () => header } } },
	};
}

function plainError(statusCode: number) {
	return { statusCode };
}

describe("useSlugRedirect (round 350)", () => {
	let replaceSpy: ReturnType<typeof vi.fn>;

	afterEach(() => {
		replaceSpy?.mockRestore();
	});

	it("hard-navigates to the canonical target on a 404 carrying the header", () => {
		replaceSpy = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
		const target = useSlugRedirect(headerError("/posts/canonical-post"));
		expect(target).toBe("/posts/canonical-post");
		expect(replaceSpy).toHaveBeenCalledWith("/posts/canonical-post");
	});

	it("reads the header from the client error shape (.response, no .cause)", () => {
		replaceSpy = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
		const error = {
			statusCode: 404,
			response: { headers: { get: () => "/series/new-series" } },
		};
		expect(useSlugRedirect(error)).toBe("/series/new-series");
		expect(replaceSpy).toHaveBeenCalledWith("/series/new-series");
	});

	it("does nothing when the 404 carries no redirect header", () => {
		replaceSpy = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
		expect(useSlugRedirect(headerError(null))).toBe("");
		expect(replaceSpy).not.toHaveBeenCalled();
	});

	it("does nothing for non-404 errors (load failure, 5xx)", () => {
		replaceSpy = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
		expect(useSlugRedirect(plainError(500))).toBe("");
		expect(useSlugRedirect(null)).toBe("");
		expect(replaceSpy).not.toHaveBeenCalled();
	});
});
