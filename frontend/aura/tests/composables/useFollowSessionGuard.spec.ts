/**
 * useFollowSessionGuard unit tests (survey finding: expired-session follow
 * dead-end on the public tags/categories/series pages).
 *
 * On a dead-session 401 the guard must drop the stored reader token (the
 * signed-in gate on those pages is localStorage PRESENCE, so the follow
 * control flips to its signed-out state automatically) and flag the sign-in
 * prompt. Transient failures (offline/429/5xx) must pass through untouched so
 * the page keeps its normal error surface.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogout = vi.fn();
const mockIsStaleSession = vi.fn();

vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({
		logout: mockLogout,
		isStaleSession: mockIsStaleSession,
	}),
}));

import { useFollowSessionGuard } from "../../composables/useFollowSessionGuard";

describe("useFollowSessionGuard", () => {
	beforeEach(() => {
		mockLogout.mockClear();
		mockIsStaleSession.mockReset();
	});

	it("drops the token and flags the sign-in prompt on a dead session (401)", () => {
		mockIsStaleSession.mockReturnValue(true);
		const { sessionExpired, guardFollowFailure } = useFollowSessionGuard();
		const cause = { response: { status: 401, _data: { detail: "Not authenticated" } } };

		expect(guardFollowFailure(cause)).toBe(true);
		expect(mockLogout).toHaveBeenCalledTimes(1);
		expect(sessionExpired.value).toBe(true);
	});

	it("leaves transient failures untouched and returns false", () => {
		mockIsStaleSession.mockReturnValue(false);
		const { sessionExpired, guardFollowFailure } = useFollowSessionGuard();

		expect(guardFollowFailure(new Error("offline"))).toBe(false);
		expect(mockLogout).not.toHaveBeenCalled();
		expect(sessionExpired.value).toBe(false);
	});

	it("keeps the prompt for repeat 401s (concurrent load + toggle)", () => {
		mockIsStaleSession.mockReturnValue(true);
		const { sessionExpired, guardFollowFailure } = useFollowSessionGuard();

		guardFollowFailure({ statusCode: 401 });
		guardFollowFailure({ response: { status: 401 } });
		expect(mockLogout.mock.calls.length).toBeGreaterThanOrEqual(1);
		expect(sessionExpired.value).toBe(true);
	});
});
