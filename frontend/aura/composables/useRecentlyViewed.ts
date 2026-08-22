/**
 * Recently viewed posts (DEC-104, TASK-164).
 *
 * A purely client-side "continue reading" trail: every post the visitor opens
 * is remembered (most-recent-first, deduped by slug, capped, stale entries
 * pruned) in localStorage so a returning reader gets a lightweight cue of where
 * they left off without re-searching. No auth or schema dependency.
 */

import { ref } from "vue";

export interface RecentlyViewedPost {
	slug: string;
	title: string;
	/** Epoch ms; used for stale-pruning. Older saved entries may lack it. */
	viewedAt?: number;
}

const STORAGE_KEY = "recently-viewed";
const MAX = 8;
// Prune entries untouched for 30 days so the trail doesn't grow forever.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function canUseStorage(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof localStorage !== "undefined" &&
		typeof localStorage.getItem === "function" &&
		typeof localStorage.setItem === "function"
	);
}

function read(): RecentlyViewedPost[] {
	if (!canUseStorage()) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const now = Date.now();
		return parsed
			.filter((x): x is RecentlyViewedPost => {
				if (!x || typeof x.slug !== "string" || typeof x.title !== "string") return false;
				// Drop stale entries that carry a timestamp; keep legacy ones that
				// predate the timestamp field.
				const seenAt = (x as RecentlyViewedPost).viewedAt;
				return seenAt === undefined || now - seenAt < MAX_AGE_MS;
			})
			.slice(0, MAX);
	} catch {
		return [];
	}
}

function write(items: RecentlyViewedPost[]): void {
	if (!canUseStorage()) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
	} catch {
		// Storage full / unavailable — the in-memory trail still works this visit.
	}
}

// Module-level reactive mirror of the persisted trail (survives SPA navs).
const recent = ref<RecentlyViewedPost[]>(read());

export function useRecentlyViewed() {
	/** Record a post as just viewed: moves it to the front, dedups, caps. */
	function record(post: { slug: string; title: string }): void {
		if (!post?.slug || !post.title) return;
		const now = Date.now();
		const entries = read().filter((x) => x.slug !== post.slug);
		entries.unshift({ slug: post.slug, title: post.title, viewedAt: now });
		const capped = entries.slice(0, MAX);
		write(capped);
		recent.value = capped;
	}

	/** Clear the trail (e.g. a "clear" action or tests). */
	function clear(): void {
		write([]);
		recent.value = [];
	}

	return { recent, record, clear };
}
