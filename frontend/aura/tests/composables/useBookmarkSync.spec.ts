/** useBookmarkSync tests (DEC-059, TASK-134). */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const addReaderBookmarkMock = vi.fn();
const removeReaderBookmarkMock = vi.fn();
const fetchReaderBookmarksMock = vi.fn();
const clearReaderBookmarksMock = vi.fn(() => Promise.resolve(null));

vi.mock("~~/api/reader/bookmarks", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../api/reader/bookmarks")>();
	return {
		...actual,
		addReaderBookmark: addReaderBookmarkMock,
		removeReaderBookmark: removeReaderBookmarkMock,
		getReaderBookmarks: fetchReaderBookmarksMock,
		clearReaderBookmarks: clearReaderBookmarksMock,
	};
});

import { syncIssue, useBookmarkSync } from "../../composables/useBookmarkSync";
import { useBookmarks } from "../../composables/useBookmarks";

const cloudItem = {
	id: 9,
	title: "Cloud post",
	slug: "cloud-post",
	excerpt: null,
	cover_image: null,
	created_at: "2026-08-19T00:00:00Z",
	category: { id: 1, name: "Tech" },
	tags: [{ id: 1, name: "vue" }],
};

function okFetch(items: unknown[]) {
	return {
		data: vi.fn(() => ({ value: { items, total: items.length } }))(),
		error: vi.fn(() => ({ value: null }))(),
	};
}

// A keyed useState stub so every useBookmarks() call in this module observes
// ONE shared reactive list (the Nuxt singleton behavior — mirrors the official
// useBookmarks.spec.ts). Without it, vitest's per-call ref fallback would give
// useBookmarkSync and the test two unrelated lists.
const sharedBookmarks = ref<
	{
		id: number;
		title: string;
		slug: string;
		excerpt: string | null;
		cover_image: string | null;
		created_at: string;
		category: { id: number; name: string } | null;
		tags: { id: number; name: string }[];
	}[]
>([]);
vi.stubGlobal("useState", () => sharedBookmarks);

beforeEach(() => {
	localStorage.clear();
	sharedBookmarks.value = [];
	addReaderBookmarkMock.mockReset();
	removeReaderBookmarkMock.mockReset();
	fetchReaderBookmarksMock.mockReset();
	clearReaderBookmarksMock.mockReset();
	// syncIssue is module-scoped (shared by every useBookmarkSync instance).
	syncIssue.value = null;
});

afterEach(() => {
	localStorage.clear();
	sharedBookmarks.value = [];
	syncIssue.value = null;
});

describe("useBookmarkSync", () => {
	it("does not touch the cloud when logged out", async () => {
		const sync = useBookmarkSync();
		sync.add({
			id: 1,
			title: "Local",
			slug: "l",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});
		await vi.waitFor(() => expect(addReaderBookmarkMock).not.toHaveBeenCalled());
		expect(useBookmarks().bookmarks.value.length).toBe(1);
	});

	it("mirrors an add to the cloud when signed in", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		addReaderBookmarkMock.mockResolvedValue(okFetch([null]));
		const sync = useBookmarkSync();

		sync.add({
			id: 1,
			title: "Local",
			slug: "l",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});
		await vi.waitFor(() => expect(addReaderBookmarkMock).toHaveBeenCalledWith(1));
	});

	it("mirrors a remove to the cloud when signed in", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		removeReaderBookmarkMock.mockResolvedValue(okFetch([null]));
		const sync = useBookmarkSync();
		useBookmarks().addBookmark({
			id: 2,
			title: "T",
			slug: "t",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});

		sync.remove(2);
		await vi.waitFor(() => expect(removeReaderBookmarkMock).toHaveBeenCalledWith(2));
		expect(useBookmarks().isBookmarked(2)).toBe(false);
	});

	it("swallows a failed cloud mirror (offline keeps local)", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		addReaderBookmarkMock.mockRejectedValue(new Error("offline"));
		const sync = useBookmarkSync();

		sync.add({
			id: 5,
			title: "Offline",
			slug: "o",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});
		// The failed mirror must not throw or undo the local add.
		await vi.waitFor(() => expect(addReaderBookmarkMock).toHaveBeenCalledWith(5));
		expect(useBookmarks().isBookmarked(5)).toBe(true);
		// Transient failures stay silent — only a dead session warns (ISS-222).
		expect(sync.syncIssue.value).toBeNull();
	});

	it("surfaces an auth mirror failure (401 token expired) via syncIssue", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		addReaderBookmarkMock.mockRejectedValue({ response: { status: 401 } });
		const sync = useBookmarkSync();

		sync.add({
			id: 6,
			title: "Expired",
			slug: "e",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});
		await vi.waitFor(() => expect(addReaderBookmarkMock).toHaveBeenCalledWith(6));
		// The local toggle still works, but the reader is now warned that the
		// save never reached the cloud (dead session), instead of being silently
		// divergent until the next merge pulls the bookmark away.
		expect(useBookmarks().isBookmarked(6)).toBe(true);
		expect(sync.syncIssue.value).toBe("auth");
	});

	it("treats a 403 mirror failure as auth too (wrong-audience token)", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		removeReaderBookmarkMock.mockRejectedValue({ status: 403 });
		const sync = useBookmarkSync();
		useBookmarks().addBookmark({
			id: 7,
			title: "Forbidden",
			slug: "f",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});

		sync.remove(7);
		await vi.waitFor(() => expect(removeReaderBookmarkMock).toHaveBeenCalledWith(7));
		expect(useBookmarks().isBookmarked(7)).toBe(false);
		expect(sync.syncIssue.value).toBe("auth");
	});

	it("recognises the ofetch FetchError shape (status on the error itself)", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		const err = Object.assign(new Error("401"), { status: 401, statusCode: 401 });
		addReaderBookmarkMock.mockRejectedValue(err);
		const sync = useBookmarkSync();

		sync.add({
			id: 8,
			title: "FetchError",
			slug: "fe",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});
		await vi.waitFor(() => expect(addReaderBookmarkMock).toHaveBeenCalledWith(8));
		expect(sync.syncIssue.value).toBe("auth");
	});

	it("clears a stale auth warning once a later mirror succeeds", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		addReaderBookmarkMock
			.mockRejectedValueOnce({ response: { status: 401 } })
			.mockResolvedValueOnce(okFetch([null]));
		const sync = useBookmarkSync();
		const post = {
			id: 12,
			title: "Recover",
			slug: "r",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		};

		sync.add(post);
		await vi.waitFor(() => expect(addReaderBookmarkMock).toHaveBeenCalledTimes(1));
		expect(sync.syncIssue.value).toBe("auth");

		// Reader re-authenticated (fresh token): the next mirror works and the
		// warning is no longer relevant.
		sync.add({ ...post, id: 13 });
		await vi.waitFor(() => expect(addReaderBookmarkMock).toHaveBeenCalledTimes(2));
		expect(sync.syncIssue.value).toBeNull();
	});

	it("exposes clearSyncIssue to dismiss the warning", () => {
		localStorage.setItem("reader_token", "jwt.token");
		const sync = useBookmarkSync();
		sync.syncIssue.value = "auth";
		sync.clearSyncIssue();
		expect(sync.syncIssue.value).toBeNull();
	});

	it("shares ONE auth warning across useBookmarkSync instances (post-page toggle lights the /bookmarks banner)", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		// Two independent callers observe the same module-scoped syncIssue ref:
		// a BookmarkButton on the post page and the /bookmarks page banner.
		const postPage = useBookmarkSync();
		const bookmarksPage = useBookmarkSync();
		expect(postPage.syncIssue).toBe(bookmarksPage.syncIssue);

		// A 401 on the post-page toggle is visible to the bookmarks page.
		addReaderBookmarkMock.mockRejectedValue({ response: { status: 401 } });
		postPage.add({
			id: 15,
			title: "Cross",
			slug: "x",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});
		await vi.waitFor(() => expect(bookmarksPage.syncIssue.value).toBe("auth"));

		// And a later successful mirror from either instance clears it for both.
		postPage.clearSyncIssue();
		addReaderBookmarkMock.mockResolvedValue(okFetch([null]));
		bookmarksPage.add({
			id: 16,
			title: "Cross2",
			slug: "x2",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});
		await vi.waitFor(() => expect(addReaderBookmarkMock).toHaveBeenCalledWith(16));
		expect(postPage.syncIssue.value).toBeNull();
	});

	it("merge with a 401 keeps the local list and warns instead of adopting it", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		fetchReaderBookmarksMock.mockRejectedValue({ response: { status: 401 } });
		const sync = useBookmarkSync();
		useBookmarks().addBookmark({
			id: 14,
			title: "Fragile",
			slug: "fr",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});

		await sync.mergeLocalToCloud();

		// The failed pull must NOT replace the local list with the (unreachable)
		// server truth — otherwise a dead session silently deletes local-only
		// bookmarks. Instead the reader gets the auth warning.
		expect(useBookmarks().bookmarks.value.map((b) => b.id)).toEqual([14]);
		expect(sync.syncIssue.value).toBe("auth");
	});

	it("merge pushes local up then adopts the cloud list (union outcome)", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		addReaderBookmarkMock.mockResolvedValue(okFetch([null]));
		// getReaderBookmarks resolves with the settled list response directly.
		fetchReaderBookmarksMock.mockResolvedValue({ items: [cloudItem], total: 1 });
		const sync = useBookmarkSync();
		useBookmarks().addBookmark({
			id: 3,
			title: "Local only",
			slug: "lo",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-02",
			category: null,
			tags: [],
		});

		await sync.mergeLocalToCloud();

		// local id 3 was pushed up, then the cloud's union list was adopted.
		expect(addReaderBookmarkMock).toHaveBeenCalledWith(3);
		expect(useBookmarks().bookmarks.value.map((b) => b.id)).toEqual([9]);
	});

	it("merge pages through total_pages so no bookmarks are dropped (ISS-142)", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		addReaderBookmarkMock.mockResolvedValue(okFetch([null]));
		const p1 = { ...cloudItem, id: 9 };
		const p2 = { ...cloudItem, id: 10 };
		fetchReaderBookmarksMock
			.mockResolvedValueOnce({ items: [p1], total: 2, page: 1, limit: 1, total_pages: 2 })
			.mockResolvedValueOnce({ items: [p2], total: 2, page: 2, limit: 1, total_pages: 2 });
		const sync = useBookmarkSync();

		await sync.mergeLocalToCloud();

		expect(fetchReaderBookmarksMock).toHaveBeenCalledTimes(2);
		expect(useBookmarks().bookmarks.value.map((b) => b.id)).toEqual([9, 10]);
	});

	it("keeps a bookmark added mid-merge in the UI (deep-dive)", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		addReaderBookmarkMock.mockResolvedValue(okFetch([null]));
		// The cloud pull hangs so the test can add a bookmark mid-merge.
		let resolveFetch!: (v: unknown) => void;
		fetchReaderBookmarksMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				}),
		);
		const sync = useBookmarkSync();
		const bookmarksStore = useBookmarks();
		bookmarksStore.addBookmark({
			id: 3,
			title: "Local",
			slug: "l",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-02",
			category: null,
			tags: [],
		});

		const mergePromise = sync.mergeLocalToCloud(); // hangs on the GET stage
		await flushPromises();
		// The reader taps a bookmark while the merge is pulling the server list.
		sync.add({
			id: 7,
			title: "New",
			slug: "n",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-03",
			category: null,
			tags: [],
		});

		// The cloud pull resolves WITHOUT the mid-merge add (its PUT may not even
		// have landed yet) — the union guard must keep it in the UI, not clobber
		// it back to the pre-merge server truth.
		resolveFetch({ items: [cloudItem], total: 1 });
		await mergePromise;

		const ids = bookmarksStore.bookmarks.value.map((b) => b.id).sort((a, b) => a - b);
		expect(ids).toEqual([7, 9]);
	});

	it("starts syncing when a reader token is present (empty-state gate, deep-dive)", () => {
		// /bookmarks gates its empty state behind `syncing`; if it starts false
		// on a signed-in fresh device, the very first paint flashes "you have no
		// bookmarks yet" before mount's merge sets the flag.
		localStorage.setItem("reader_token", "jwt");
		expect(useBookmarkSync().syncing.value).toBe(true);

		localStorage.removeItem("reader_token");
		expect(useBookmarkSync().syncing.value).toBe(false);
	});

	it("stops pushing cleared ids when Clear-all lands mid-push (TASK-233, deep-dive)", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		addReaderBookmarkMock.mockResolvedValue(okFetch([null]));
		fetchReaderBookmarksMock.mockResolvedValue({ items: [cloudItem], total: 1 });
		const sync = useBookmarkSync();
		const bookmarksStore = useBookmarks();
		bookmarksStore.addBookmark({
			id: 1,
			title: "One",
			slug: "1",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-01",
			category: null,
			tags: [],
		});
		bookmarksStore.addBookmark({
			id: 2,
			title: "Two",
			slug: "2",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-02",
			category: null,
			tags: [],
		});

		// The first PUT (id 1) hangs so the test can clear mid-push.
		let resolvePut!: (v: unknown) => void;
		addReaderBookmarkMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolvePut = resolve;
				}),
		);
		const mergePromise = sync.mergeLocalToCloud();
		await flushPromises();

		// The reader clicks Clear-all while the merge is still pushing. The local
		// list wipes immediately, but the cloud DELETE must WAIT for the in-flight
		// PUT to settle first (otherwise it can land after the DELETE and
		// resurrect the id server-side) — so clearAll stays pending until the PUT
		// is released.
		const clearPromise = sync.clearAll();
		await flushPromises();
		expect(clearReaderBookmarksMock).not.toHaveBeenCalled();

		// Release the in-flight PUT; the second id must NOT be pushed (the
		// per-PUT membership check skips ids no longer in the local list), and
		// the stale pull snapshot must not restore anything. Only once the PUT
		// settled does the clear's DELETE fire.
		resolvePut(okFetch([null]));
		await flushPromises();
		expect(addReaderBookmarkMock).not.toHaveBeenCalledWith(2);
		await clearPromise;
		expect(clearReaderBookmarksMock).toHaveBeenCalled();
		await mergePromise;
		expect(bookmarksStore.bookmarks.value.map((b) => b.id)).toEqual([]);
	});

	it("does not resurrect a bookmark removed mid-merge (deep-dive)", async () => {
		localStorage.setItem("reader_token", "jwt.token");
		addReaderBookmarkMock.mockResolvedValue(okFetch([null]));
		const sync = useBookmarkSync();
		const bookmarksStore = useBookmarks();
		bookmarksStore.addBookmark({
			id: 3,
			title: "Local",
			slug: "l",
			excerpt: null,
			cover_image: null,
			created_at: "2026-01-02",
			category: null,
			tags: [],
		});

		// The cloud pull hangs so the test can remove a bookmark mid-merge.
		let resolveFetch!: (v: unknown) => void;
		fetchReaderBookmarksMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				}),
		);
		const mergePromise = sync.mergeLocalToCloud();
		await flushPromises();

		// The reader removes bookmark 3 while the merge is pulling the list.
		sync.remove(3);
		await flushPromises();

		// The (stale) server snapshot still contains 3 — its DELETE has not
		// landed yet, so the pull must not resurrect it in the UI.
		resolveFetch({ items: [{ ...cloudItem, id: 3 }], total: 1 });
		await mergePromise;

		expect(bookmarksStore.bookmarks.value.map((b) => b.id)).toEqual([]);
	});

	it("merge is a no-op when signed out", async () => {
		await useBookmarkSync().mergeLocalToCloud();
		expect(fetchReaderBookmarksMock).not.toHaveBeenCalled();
	});
});
