/**
 * Shared unread-notification badge state (ISS-124, TASK-224).
 *
 * The nav unread badge (default.vue) and the /notifications inbox used to keep
 * their own local unread counts, so marking notifications read on the inbox
 * page never updated the nav badge until a full page reload. This module-level
 * singleton (same pattern as useReaderAuth / useBookmarks) owns the badge count
 * so any page can refresh it after a read action, and the layout can keep it
 * fresh with a light poll — the default.vue comment already promised "polled",
 * but the original implementation only fetched once on mount.
 *
 * Guests are a no-op (the badge is reader-only): refresh() resets the count to
 * 0, and startPolling() declines to schedule anything.
 */

import { ref } from "vue";
import { getReaderNotifications } from "~~/api/reader/notifications";
import { useReaderAuth } from "./useReaderAuth";

/** Poll cadence while the tab is visible and signed in. */
const POLL_INTERVAL_MS = 60_000;

const unreadCount = ref(0);
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function useNotificationBadge() {
	const { isAuthenticated } = useReaderAuth();

	/** Re-fetch the unread total from the server; resets to 0 when signed out. */
	async function refresh(): Promise<void> {
		if (!isAuthenticated.value) {
			unreadCount.value = 0;
			return;
		}
		try {
			const data = await getReaderNotifications(1, 1);
			// Re-check auth after the await: a fetch started while signed in can
			// resolve after logout(), and writing a signed-in count then would
			// leave a stale nonzero badge visible for the next login.
			if (!isAuthenticated.value) {
				unreadCount.value = 0;
				return;
			}
			unreadCount.value = data.unread;
		} catch {
			// Best-effort badge — a transient failure must not break the nav.
			// Keep the previous count rather than flashing it to 0.
		}
	}

	/** Start the light poll (no-op when already running or signed out). */
	function startPolling(): void {
		if (pollTimer || !isAuthenticated.value) return;
		void refresh();
		pollTimer = setInterval(() => {
			// Skip while the tab is hidden: no point burning a request the
			// reader isn't looking at; the next visible tick picks it up.
			if (typeof document === "undefined" || document.hidden) return;
			void refresh();
		}, POLL_INTERVAL_MS);
	}

	/** Stop the poll (layout unmount / sign-out). */
	function stopPolling(): void {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	return { unreadCount, refresh, startPolling, stopPolling };
}
