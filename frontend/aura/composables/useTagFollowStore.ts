import { type ComputedRef, computed, ref } from "vue";
import {
	followReaderTag,
	getReaderTagFollows,
	setTagFollowNotify,
	unfollowReaderTag,
} from "~~/api/reader/follows";

/**
 * Shared reader tag-follow state for the reading surface (DEC-196/TASK-216).
 *
 * Module-scoped singleton so every TagFollowButton on a page shares one
 * GET /api/reader/me/tag-follows instead of fetching once per tag chip, and
 * follows stay in sync across SPA navigation. The account page reloads from the
 * API in its own setup, so it reflects whatever this store last persisted.
 *
 * The cache is keyed to the `reader_token` the app keeps in localStorage (the
 * same synchronous gate the /tags page uses): whenever the token string changes
 * (sign-in, sign-out, or a different reader), the previous reader's cache is
 * discarded before refetching, so state can never leak across readers.
 */

export interface TagFollowEntry {
	/** Whether new-post push is enabled for this follow (TASK-215). */
	notify: boolean;
}

const entries = ref<Record<number, TagFollowEntry>>({});
const busyById = ref<Record<number, boolean>>({});
let loadedForKey: string | null = null;
let loadPromise: Promise<boolean> | null = null;

/** The synchronous auth gate the app already uses for reader-only controls. */
function currentReaderKey(): string {
	if (typeof window === "undefined") return "";
	return window.localStorage?.getItem("reader_token") ?? "";
}

function isFollowing(tagId: number): boolean {
	return entries.value[tagId] !== undefined;
}

async function ensureLoaded(): Promise<boolean> {
	const key = currentReaderKey();
	if (!key) {
		reset();
		return false;
	}
	if (loadedForKey === key) return true;
	if (loadPromise) return loadPromise;
	// A different (or first) reader: drop any stale cache before refetching so
	// buttons never render the previous reader's follows during the load.
	reset();
	loadPromise = (async () => {
		try {
			const res = await getReaderTagFollows();
			const next: Record<number, TagFollowEntry> = {};
			for (const item of res.items) next[item.id] = { notify: item.notify };
			entries.value = next;
			loadedForKey = key;
			return true;
		} catch {
			return false;
		} finally {
			loadPromise = null;
		}
	})();
	return loadPromise;
}

async function toggleFollow(tagId: number): Promise<void> {
	if (busyById.value[tagId]) return;
	busyById.value[tagId] = true;
	try {
		if (isFollowing(tagId)) {
			await unfollowReaderTag(tagId);
			delete entries.value[tagId];
		} else {
			const res = await followReaderTag(tagId);
			// Follow the API's persisted notify state so a server-side toggle
			// (e.g. an earlier opt-out) wins over the local default.
			entries.value[tagId] = { notify: res.notify };
		}
	} finally {
		busyById.value[tagId] = false;
	}
}

async function setNotify(tagId: number, notify: boolean): Promise<void> {
	// Backend 404s a notify PATCH when the reader isn't following; guard locally.
	if (busyById.value[tagId] || !isFollowing(tagId)) return;
	busyById.value[tagId] = true;
	try {
		const res = await setTagFollowNotify(tagId, notify);
		entries.value[tagId] = { notify: res.notify };
	} finally {
		busyById.value[tagId] = false;
	}
}

/** Drop all cached follow state (tests, logout, reader switch). */
function reset(): void {
	entries.value = {};
	busyById.value = {};
	loadedForKey = null;
	loadPromise = null;
}

export function useTagFollowStore() {
	return {
		ensureLoaded,
		toggleFollow,
		setNotify,
		reset,
		following: (tagId: number): ComputedRef<boolean> => computed(() => isFollowing(tagId)),
		notify: (tagId: number): ComputedRef<boolean> =>
			computed(() => (isFollowing(tagId) ? (entries.value[tagId]?.notify ?? true) : true)),
		busy: (tagId: number): ComputedRef<boolean> => computed(() => busyById.value[tagId] ?? false),
	};
}
