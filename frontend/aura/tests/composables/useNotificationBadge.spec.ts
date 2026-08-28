/**
 * useNotificationBadge composable tests (ISS-124, TASK-224).
 *
 * The badge count is a module-level singleton shared by the default layout and
 * the /notifications inbox, so a `refresh()` after mark-read actions drops the
 * nav count immediately. Guests are a no-op; polling skips hidden tabs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const authRef = ref(false);
const fetchNotifications = vi.fn();

vi.mock("~~/api/reader/notifications", () => ({
	getReaderNotifications: (...a: unknown[]) => fetchNotifications(...a),
}));

vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated: authRef }),
}));

import { useNotificationBadge } from "../../composables/useNotificationBadge";

/** The vitest env here is node — no DOM — so the hidden-tab guard needs a
 * stubbed document for the polling tests. */
function stubDocument(hidden: boolean) {
	vi.stubGlobal("document", { hidden });
}

describe("useNotificationBadge (TASK-224)", () => {
	beforeEach(async () => {
		authRef.value = false;
		fetchNotifications.mockReset();
		useNotificationBadge().stopPolling();
		// The shared singleton count persists across tests (module-scope ref);
		// reset it deterministically here rather than leaving each test to work
		// around whatever the previous one left behind. A guest refresh sets 0
		// synchronously without issuing an API call, so this is side-effect free.
		await useNotificationBadge().refresh();
		vi.useRealTimers();
	});

	afterEach(() => {
		useNotificationBadge().stopPolling();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("resets to 0 and skips the API for guests", async () => {
		const { unreadCount, refresh } = useNotificationBadge();
		unreadCount.value = 5; // prior signed-in state
		await refresh();
		expect(unreadCount.value).toBe(0);
		expect(fetchNotifications).not.toHaveBeenCalled();
	});

	it("stores the unread total from the API when signed in", async () => {
		authRef.value = true;
		fetchNotifications.mockResolvedValue({ unread: 3 });
		const { unreadCount, refresh } = useNotificationBadge();
		await refresh();
		expect(fetchNotifications).toHaveBeenCalledWith(1, 1);
		expect(unreadCount.value).toBe(3);
	});

	it("keeps the previous count when the fetch fails", async () => {
		authRef.value = true;
		fetchNotifications.mockRejectedValue(new Error("network"));
		const { unreadCount, refresh } = useNotificationBadge();
		unreadCount.value = 7;
		await refresh();
		expect(unreadCount.value).toBe(7);
	});

	it("startPolling fetches immediately and re-polls while visible", async () => {
		authRef.value = true;
		fetchNotifications.mockResolvedValue({ unread: 2 });
		vi.useFakeTimers();
		stubDocument(false);

		const { unreadCount, startPolling } = useNotificationBadge();
		startPolling();

		// Immediate refresh happens on start.
		expect(fetchNotifications).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetchNotifications).toHaveBeenCalledTimes(2);
		expect(unreadCount.value).toBe(2);
	});

	it("discards a signed-in fetch that resolves after the session ends (ISS-124)", async () => {
		// A refresh started while signed in can resolve after logout(); the
		// count must not be written back over the now-0 baseline.
		authRef.value = true;
		let resolveFetch!: (v: { unread: number }) => void;
		fetchNotifications.mockImplementation(
			() =>
				new Promise<{ unread: number }>((resolve) => {
					resolveFetch = resolve;
				}),
		);

		const { unreadCount, refresh } = useNotificationBadge();
		const pending = refresh();
		authRef.value = false; // sign-out lands before the fetch resolves
		resolveFetch({ unread: 4 });
		await pending;

		expect(unreadCount.value).toBe(0);
	});

	it("skips re-polling while the tab is hidden", async () => {
		authRef.value = true;
		fetchNotifications.mockResolvedValue({ unread: 1 });
		vi.useFakeTimers();
		stubDocument(true);

		const { startPolling } = useNotificationBadge();
		startPolling();

		// The immediate refresh still runs; the interval skips hidden tabs.
		expect(fetchNotifications).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(180_000);
		expect(fetchNotifications).toHaveBeenCalledTimes(1);
	});

	it("startPolling is a no-op for guests", () => {
		vi.useFakeTimers();
		stubDocument(false);
		const { startPolling } = useNotificationBadge();
		startPolling();
		vi.advanceTimersByTime(120_000);
		expect(fetchNotifications).not.toHaveBeenCalled();
	});

	it("stopPolling prevents further polls", () => {
		authRef.value = true;
		fetchNotifications.mockResolvedValue({ unread: 0 });
		vi.useFakeTimers();
		stubDocument(false);

		const { startPolling, stopPolling } = useNotificationBadge();
		startPolling();
		const callsAfterStart = fetchNotifications.mock.calls.length;
		stopPolling();
		vi.advanceTimersByTime(120_000);
		expect(fetchNotifications.mock.calls.length).toBe(callsAfterStart);
	});
});
