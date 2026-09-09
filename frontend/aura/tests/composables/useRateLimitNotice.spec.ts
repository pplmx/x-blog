/** useRateLimitNotice tests (round 211 — app-wide 429 notice). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use fake timers so the 6s auto-dismiss can be asserted without waiting.
beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("useRateLimitNotice", () => {
	it("starts hidden", async () => {
		const { active } = (await import("../../composables/useRateLimitNotice")).useRateLimitNotice();
		expect(active.value).toBe(false);
	});

	it("show turns the banner on", async () => {
		const notifier = (await import("../../composables/useRateLimitNotice")).useRateLimitNotice();
		notifier.show();
		expect(notifier.active.value).toBe(true);
	});

	it("auto-dismisses after the visibility window", async () => {
		const notifier = (await import("../../composables/useRateLimitNotice")).useRateLimitNotice();
		notifier.show();
		expect(notifier.active.value).toBe(true);
		vi.advanceTimersByTime(6000);
		expect(notifier.active.value).toBe(false);
	});

	it("dismiss hides immediately and cancels the timer", async () => {
		const notifier = (await import("../../composables/useRateLimitNotice")).useRateLimitNotice();
		notifier.show();
		notifier.dismiss();
		expect(notifier.active.value).toBe(false);
		// After an explicit dismiss, the pending timer must not re-show it.
		vi.advanceTimersByTime(6000);
		expect(notifier.active.value).toBe(false);
	});

	it("a burst of shows stays a single banner (restarts the timer, not stacking)", async () => {
		const notifier = (await import("../../composables/useRateLimitNotice")).useRateLimitNotice();
		notifier.show();
		vi.advanceTimersByTime(3000);
		notifier.show();
		// Still on after the first window would have closed it (timer restarted).
		vi.advanceTimersByTime(4000);
		expect(notifier.active.value).toBe(true);
		vi.advanceTimersByTime(2000);
		expect(notifier.active.value).toBe(false);
	});

	it("dismiss with nothing showing is a no-op (no pending timer)", async () => {
		const notifier = (await import("../../composables/useRateLimitNotice")).useRateLimitNotice();
		notifier.dismiss();
		expect(notifier.active.value).toBe(false);
		vi.advanceTimersByTime(6000);
		expect(notifier.active.value).toBe(false);
	});

	it("after the window auto-dismisses, the timer slot is not reused twice", async () => {
		// The timer callback flips active off; a later dismiss must not re-arm or
		// throw even though the (already-fired) timer handle is still stored.
		const notifier = (await import("../../composables/useRateLimitNotice")).useRateLimitNotice();
		notifier.show();
		vi.advanceTimersByTime(6000); // auto-dismiss fires
		expect(notifier.active.value).toBe(false);
		notifier.dismiss(); // clears the fired handle
		expect(notifier.active.value).toBe(false);
	});
});
