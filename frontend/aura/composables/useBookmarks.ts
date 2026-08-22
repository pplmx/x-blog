import { computed, type Ref, ref } from "vue";

export interface Bookmark {
	id: number;
	title: string;
	slug: string;
	excerpt: string | null;
	cover_image: string | null;
	created_at: string;
	folder_id?: number | null;
	folder_name?: string | null;
	category: { id: number; name: string } | null;
	tags: { id: number; name: string }[];
}

const STORAGE_KEY = "x_blog_bookmarks";
const STATE_KEY = "x_blog_bookmarks_state";

function isClient(): boolean {
	return typeof window !== "undefined";
}

// Whether Nuxt globals (useState) are available. In vitest they aren't, so we
// fall back to a plain module-scoped ref (see the isClient guard below).
function canUseNuxt(): boolean {
	return typeof useState === "function";
}

// localStorage is client-only, but useState initializes during SSR where
// window is undefined — the server serializes an empty array and the client
// reuses it, so on a full page load we must re-read storage once, client-side,
// before any user interaction. Guarded so we don't clobber genuine edits.
let hydratedFromStorage = false;
function ensureClientHydration(bookmarks: Ref<Bookmark[]>): void {
	if (!isClient() || hydratedFromStorage) return;
	bookmarks.value = loadFromStorage();
	hydratedFromStorage = true;
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
	// Backing array is a Nuxt `useState` singleton so every consumer
	// (BookmarkButton, Sidebar count, /bookmarks page) shares one reactive
	// source — a plain `ref()` per call kept each component's bookmarks out of
	// sync until a reload (RIL ISS-036). In vitest there is no `useState`, so
	// use a local ref (tests stub useState explicitly to exercise the shared path).
	const bookmarks = canUseNuxt()
		? useState<Bookmark[]>(STATE_KEY, () => loadFromStorage())
		: ref<Bookmark[]>(loadFromStorage());

	// On a full page load the useState value arrives SSR-serialized (empty when
	// window was undefined on the server); re-read localStorage once client-side.
	if (canUseNuxt()) {
		ensureClientHydration(bookmarks);
	}

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

	/** Replace the whole list (used by cloud sync to adopt the merged server
	 * list as the local truth; dedupes defensively by post id). */
	function replaceBookmarks(items: Bookmark[]): void {
		if (!isClient()) return;
		const seen = new Set<number>();
		const deduped: Bookmark[] = [];
		for (const b of items) {
			if (seen.has(b.id)) continue;
			seen.add(b.id);
			deduped.push(b);
		}
		bookmarks.value = deduped;
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
		replaceBookmarks,
		bookmarkCount,
		refresh,
	};
}
