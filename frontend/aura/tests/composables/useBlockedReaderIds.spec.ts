/**
 * useBlockedReaderIds composable tests (round 386, DEC-437).
 *
 * The composable exposes the signed-in viewer's block list as a reactive set
 * (a receiver-side opt-out, DEC-425) so the thread, discussion feed and
 * comment search can drop blocked authors' rows. Guests short-circuit to an
 * empty set (the anonymous fast path is byte-identical); the fetch is best
 * effort — a failure must never break a public comment surface.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const authRef = ref(false);
const getBlockedReaders = vi.fn();

vi.mock("~~/api/reader/blocks", () => ({
	getBlockedReaders: (...a: unknown[]) => getBlockedReaders(...a),
}));

vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated: authRef }),
}));

import { useBlockedReaderIds } from "../../composables/useBlockedReaderIds";

describe("useBlockedReaderIds (round 386, DEC-437)", () => {
	beforeEach(() => {
		authRef.value = false;
		getBlockedReaders.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns an empty set and skips the API for guests", async () => {
		const { blockedReaderIds, loadBlockedReaderIds } = useBlockedReaderIds();
		await loadBlockedReaderIds();
		expect(blockedReaderIds.value.size).toBe(0);
		expect(getBlockedReaders).not.toHaveBeenCalled();
	});

	it("captures the viewer's blocked reader ids when signed in", async () => {
		authRef.value = true;
		getBlockedReaders.mockResolvedValue({
			items: [
				{ reader_id: 42, display_name: "Spammy", avatar_url: null, blocked_at: null },
				{ reader_id: 7, display_name: null, avatar_url: null, blocked_at: null },
			],
			total: 2,
		});
		const { blockedReaderIds, loadBlockedReaderIds } = useBlockedReaderIds();
		await loadBlockedReaderIds();
		expect(getBlockedReaders).toHaveBeenCalledTimes(1);
		expect([...blockedReaderIds.value].sort((a, b) => a - b)).toEqual([7, 42]);
	});

	it("loads the set only once per consumer", async () => {
		authRef.value = true;
		getBlockedReaders.mockResolvedValue({ items: [], total: 0 });
		const { loadBlockedReaderIds } = useBlockedReaderIds();
		await loadBlockedReaderIds();
		await loadBlockedReaderIds();
		await loadBlockedReaderIds();
		expect(getBlockedReaders).toHaveBeenCalledTimes(1);
	});

	it("degrades to an empty set and never throws when the fetch fails", async () => {
		authRef.value = true;
		getBlockedReaders.mockRejectedValue(new Error("network down"));
		const { blockedReaderIds, loadBlockedReaderIds } = useBlockedReaderIds();
		await expect(loadBlockedReaderIds()).resolves.toBeUndefined();
		expect(blockedReaderIds.value.size).toBe(0);
	});
});
