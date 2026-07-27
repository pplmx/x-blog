import { computed, ref } from "vue";

export interface Bookmark {
	id: number;
	title: string;
	slug: string;
	excerpt: string | null;
	cover_image: string | null;
	created_at: string;
	category: { id: number; name: string } | null;
	tags: { id: number; name: string }[];
}

const STORAGE_KEY = "x_blog_bookmarks";

function isClient(): boolean {
	return typeof window !== "undefined";
}

function loadFromStorage(): Bookmark[] {
	if (!isClient()) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		return JSON.parse(raw) as Bookmark[];
	} catch {
		return [];
	}
}

function saveToStorage(bookmarks: Bookmark[]): void {
	if (!isClient()) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
	} catch {
		// Storage full or unavailable — silently ignore
	}
}

export function useBookmarks() {
	const bookmarks = ref<Bookmark[]>(loadFromStorage());

	function isBookmarked(id: number): boolean {
		return bookmarks.value.some((b) => b.id === id);
	}

	function addBookmark(post: Bookmark): void {
		if (!isClient()) return;
		if (isBookmarked(post.id)) return;
		bookmarks.value = [...bookmarks.value, post];
		saveToStorage(bookmarks.value);
	}

	function removeBookmark(id: number): void {
		if (!isClient()) return;
		const before = bookmarks.value.length;
		bookmarks.value = bookmarks.value.filter((b) => b.id !== id);
		if (bookmarks.value.length !== before) {
			saveToStorage(bookmarks.value);
		}
	}

	function toggleBookmark(post: Bookmark): void {
		if (!isClient()) return;
		if (isBookmarked(post.id)) {
			removeBookmark(post.id);
		} else {
			addBookmark(post);
		}
	}

	function clearBookmarks(): void {
		if (!isClient()) return;
		bookmarks.value = [];
		saveToStorage(bookmarks.value);
	}

	function refresh(): void {
		bookmarks.value = loadFromStorage();
	}

	const bookmarkCount = computed(() => bookmarks.value.length);

	return {
		bookmarks,
		isBookmarked,
		addBookmark,
		removeBookmark,
		toggleBookmark,
		clearBookmarks,
		bookmarkCount,
		refresh,
	};
}
