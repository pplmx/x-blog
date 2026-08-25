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

	it("merge is a no-op when signed out", async () => {
		await useBookmarkSync().mergeLocalToCloud();
		expect(fetchReaderBookmarksMock).not.toHaveBeenCalled();
	});
});
