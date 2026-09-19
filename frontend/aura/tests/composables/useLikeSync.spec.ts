/** useLikeSync tests (round 359, DEC-391/TASK-421). */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const likeReaderPostMock = vi.fn();
const unlikeReaderPostMock = vi.fn();
const fetchReaderLikesMock = vi.fn();

vi.mock("~~/api/reader/likes", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../api/reader/likes")>();
	return {
		...actual,
		likeReaderPost: likeReaderPostMock,
		unlikeReaderPost: unlikeReaderPostMock,
		getReaderLikes: fetchReaderLikesMock,
	};
});

import { clearLikeSyncIssue, likeSyncIssue, useLikeSync } from "../../composables/useLikeSync";

// useLikes uses a Nuxt useState singleton; stub it to one shared set so the
// composable and the test observe the same state (same as useBookmarkSync).
const sharedLiked = ref<Set<number>>(new Set());
vi.stubGlobal("useState", () => sharedLiked);

const READER_TOKEN = "reader_token";

function signedIn(signedUp = true) {
	if (signedUp) localStorage.setItem(READER_TOKEN, "tok-1");
	else localStorage.removeItem(READER_TOKEN);
}

beforeEach(() => {
	localStorage.clear();
	sharedLiked.value = new Set();
	likeReaderPostMock.mockReset();
	unlikeReaderPostMock.mockReset();
	fetchReaderLikesMock.mockReset();
	clearLikeSyncIssue();
});

afterEach(() => {
	localStorage.clear();
	sharedLiked.value = new Set();
});

describe("useLikeSync", () => {
	it("like() marks locally and mirrors to the cloud when signed in", async () => {
		signedIn();
		likeReaderPostMock.mockResolvedValue({ post_id: 5, already_existed: false });

		const sync = useLikeSync();
		sync.like(5);

		expect(sync.isLiked(5)).toBe(true);
		await vi.waitFor(() => expect(likeReaderPostMock).toHaveBeenCalledWith(5));
	});

	it("does not touch the cloud when logged out (guest like stays local)", async () => {
		signedIn(false);
		const sync = useLikeSync();
		sync.like(5);

		expect(sync.isLiked(5)).toBe(true);
		// Give the (skipped) mirror a beat, then assert no cloud call landed.
		await new Promise((r) => setTimeout(r, 10));
		expect(likeReaderPostMock).not.toHaveBeenCalled();
	});

	it("unlike() clears locally and mirrors the removal when signed in", async () => {
		signedIn();
		unlikeReaderPostMock.mockResolvedValue(undefined);

		const sync = useLikeSync();
		sync.like(5);
		await vi.waitFor(() => expect(likeReaderPostMock).toHaveBeenCalledWith(5));
		expect(sync.isLiked(5)).toBe(true);

		sync.unlike(5);
		expect(sync.isLiked(5)).toBe(false);
		await vi.waitFor(() => expect(unlikeReaderPostMock).toHaveBeenCalledWith(5));
	});

	it("unlike() resolves true when the cloud DELETE lands", async () => {
		signedIn();
		unlikeReaderPostMock.mockResolvedValue(undefined);

		const sync = useLikeSync();
		sync.like(5);
		await vi.waitFor(() => expect(likeReaderPostMock).toHaveBeenCalledWith(5));

		await expect(sync.unlike(5)).resolves.toBe(true);
		expect(sync.isLiked(5)).toBe(false);
	});

	it("unlike() rolls the marker back when the cloud DELETE fails (no false removal)", async () => {
		// Offline / 5xx: the mirror is swallowed (not a hard failure — the next
		// merge re-conciliates), but unlike() must report the unpersisted removal
		// so a server-truth page (/liked) does not drop a card whose cloud row
		// still counts it (usability deep-dive).
		signedIn();
		unlikeReaderPostMock.mockRejectedValue(new Error("network down"));

		const sync = useLikeSync();
		sync.like(5);
		await vi.waitFor(() => expect(likeReaderPostMock).toHaveBeenCalledWith(5));

		await expect(sync.unlike(5)).resolves.toBe(false);
		await vi.waitFor(() => expect(unlikeReaderPostMock).toHaveBeenCalledWith(5));
		// Local marker rolled back to the server truth (still liked).
		expect(sync.isLiked(5)).toBe(true);
	});

	it("unlike() for a guest is trivially persisted (no cloud row exists)", async () => {
		signedIn(false);
		const sync = useLikeSync();
		sync.like(5);
		await expect(sync.unlike(5)).resolves.toBe(true);
		expect(sync.isLiked(5)).toBe(false);
	});

	it("mergeLocalToCloud pushes local markers up and pulls the server set down", async () => {
		signedIn();
		// Local marker 1 gets pushed up; server already has 2 and 3.
		likeReaderPostMock.mockResolvedValue({ post_id: 1, already_existed: false });
		fetchReaderLikesMock.mockResolvedValue({
			items: [
				{ id: 2, title: "B", slug: "b" },
				{ id: 3, title: "C", slug: "c" },
			],
			pagination: { total: 2, page: 1, limit: 100, total_pages: 1 },
		});

		const sync = useLikeSync();
		sync.like(1);
		// `like()` fires an async cloud mirror (dynamic import + POST). Let it
		// land (import cached, call recorded) BEFORE merge so the two code paths
		// don't race the same dynamic import inside vitest's module mock — a
		// concurrent import can resolve the real, un-mocked module and the
		// merge's network calls would fail silently. Prod is immune (one real
		// module); this only matters for test determinism.
		await vi.waitFor(() => expect(likeReaderPostMock).toHaveBeenCalledWith(1));
		expect(sync.isLiked(1)).toBe(true);

		await sync.mergeLocalToCloud();
		await flushPromises();

		// Local 1 stays in the union; server 2 and 3 were pulled in below it.
		expect(sync.isLiked(1)).toBe(true);
		expect(sync.isLiked(2)).toBe(true);
		expect(sync.isLiked(3)).toBe(true);
	});

	it("like() resolves only after the cloud mirror lands (a count refresh can't race it)", async () => {
		signedIn();
		let resolvePost!: (v: { post_id: number; already_existed: boolean }) => void;
		likeReaderPostMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvePost = resolve;
				}),
		);

		const sync = useLikeSync();
		const likePromise = sync.like(5);
		// The optimistic local flip is synchronous…
		expect(sync.isLiked(5)).toBe(true);
		// …but like() must stay pending while its POST is in flight, so a caller
		// that awaits it before refetching the count can't observe the pre-like
		// value (the fire-and-forget race the review flagged).
		await vi.waitFor(() => expect(likeReaderPostMock).toHaveBeenCalledWith(5));
		let settled = false;
		void likePromise.then(() => (settled = true));
		await flushPromises();
		expect(settled).toBe(false);

		resolvePost({ post_id: 5, already_existed: false });
		await likePromise;
		expect(settled).toBe(true);
	});

	it("does not resurrect a like unliked while the merge is in flight", async () => {
		signedIn();
		// The merge's push POST of 1 is slow; the pull still returns server row 1
		// (its DELETE hasn't landed) alongside a row this reader kept.
		let resolvePush!: () => void;
		likeReaderPostMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolvePush = resolve;
				}),
		);
		fetchReaderLikesMock.mockResolvedValue({
			items: [
				{ id: 1, title: "A", slug: "a" },
				{ id: 2, title: "B", slug: "b" },
			],
			pagination: { total: 2, page: 1, limit: 100, total_pages: 1 },
		});

		const sync = useLikeSync();
		sharedLiked.value = new Set([1]); // seed the marker directly

		const merging = sync.mergeLocalToCloud();
		await vi.waitFor(() => expect(likeReaderPostMock).toHaveBeenCalledWith(1));

		// Reader unlikes 1 while the merge is mid-push (live intent).
		sync.unlike(1);
		expect(sync.isLiked(1)).toBe(false);

		// Let the push land, then the pull's stale snapshot reconciles.
		resolvePush();
		await merging;
		await flushPromises();

		expect(sync.isLiked(1)).toBe(false); // NOT resurrected by the pull
		expect(sync.isLiked(2)).toBe(true); // the genuinely liked 2 comes in
	});

	it("flags a dead session (401) via likeSyncIssue instead of silencing it", async () => {
		signedIn();
		likeReaderPostMock.mockRejectedValue({ status: 401 });

		const sync = useLikeSync();
		sync.like(5);
		await vi.waitFor(() => expect(likeSyncIssue.value).toBe("auth"));
	});
});
