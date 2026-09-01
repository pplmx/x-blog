/** useBookmarkSync tests (DEC-059, TASK-134). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const addReaderBookmarkMock = vi.fn();
const removeReaderBookmarkMock = vi.fn();
const fetchReaderBookmarksMock = vi.fn();

vi.mock("~~/api/reader/bookmarks", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../api/reader/bookmarks")>();
	return {
		...actual,
		addReaderBookmark: addReaderBookmarkMock,
		removeReaderBookmark: removeReaderBookmarkMock,
		getReaderBookmarks: fetchReaderBookmarksMock,
	};
});

import { useBookmarkSync } from "../../composables/useBookmarkSync";
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
});

afterEach(() => {
	localStorage.clear();
	sharedBookmarks.value = [];
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

	it("merge is a no-op when signed out", async () => {
		await useBookmarkSync().mergeLocalToCloud();
		expect(fetchReaderBookmarksMock).not.toHaveBeenCalled();
	});
});
