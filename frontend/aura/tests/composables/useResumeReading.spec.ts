/**
 * useResumeReading composable tests (DEC-167, TASK-200).
 *
 * Per-post resume: a signed-in reader's last scroll offset is fetched on
 * restore() and applied to the window once the layout settles; save() records
 * it with a trailing debounce (throttling network writes) and flush() pushes
 * the pending offset on unmount/pagehide. Guests are inert — the server trail
 * is reader-only. The write path must use `$fetch` (via recordReaderHistory),
 * matching the ISS-111/DEC-165 rule for fire-and-forget lifecycle calls.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

const authRef = ref(false);
const fetchPosition = vi.fn();
const recordHistory = vi.fn();

vi.mock("~~/api/reader/history", () => ({
	getReaderReadingPosition: (...a: unknown[]) => fetchPosition(...a),
	recordReaderHistory: (...a: unknown[]) => {
		recordHistory(...a);
		// The composable fire-and-forget `.catch(() => {})`s the returned
		// promise, so the mock must resolve rather than return undefined.
		return Promise.resolve({ post_id: a[0] as number, already_existed: false });
	},
}));

vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated: authRef }),
}));

import { useResumeReading } from "../../composables/useResumeReading";

/** Mount the composable inside a tiny component so onUnmounted (flush +
 * restore cleanup) actually runs on wrapper.unmount(). */
function mountResume(postId: number) {
	const Wrapper = defineComponent({
		setup() {
			return { api: useResumeReading(() => postId) };
		},
		render: () => h("div"),
	});
	const wrapper = mount(Wrapper);
	return {
		wrapper,
		api: (wrapper.vm as unknown as { api: ReturnType<typeof useResumeReading> }).api,
	};
}

describe("useResumeReading (TASK-200)", () => {
	beforeEach(() => {
		authRef.value = false;
		fetchPosition.mockReset();
		recordHistory.mockReset();
		vi.useFakeTimers();
		window.scrollTo = vi.fn();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("is inert for guests (no fetch, no save)", async () => {
		const { api, wrapper } = mountResume(7);
		await flushPromises();

		expect(await api.restore()).toBeNull();
		expect(fetchPosition).not.toHaveBeenCalled();

		api.save(500);
		vi.advanceTimersByTime(5000);
		expect(recordHistory).not.toHaveBeenCalled();

		wrapper.unmount();
	});

	it("returns null and does not scroll when the post has no saved position", async () => {
		authRef.value = true;
		fetchPosition.mockResolvedValue({ post_id: 7, scroll_position: null });
		const { api, wrapper } = mountResume(7);

		expect(await api.restore()).toBeNull();
		expect(fetchPosition).toHaveBeenCalledWith(7);
		expect(window.scrollTo).not.toHaveBeenCalled();
		expect(api.restoredPosition.value).toBeNull();

		wrapper.unmount();
	});

	it("restores a saved position by scrolling to it", async () => {
		authRef.value = true;
		fetchPosition.mockResolvedValue({ post_id: 7, scroll_position: 1200 });
		const { api, wrapper } = mountResume(7);

		expect(await api.restore()).toBe(1200);
		expect(window.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: "auto" });
		expect(api.restoredPosition.value).toBe(1200);

		wrapper.unmount();
	});

	it("does not restore a sub-threshold offset (just-opened top)", async () => {
		authRef.value = true;
		fetchPosition.mockResolvedValue({ post_id: 7, scroll_position: 40 });
		const { api, wrapper } = mountResume(7);

		expect(await api.restore()).toBeNull();
		expect(window.scrollTo).not.toHaveBeenCalled();

		wrapper.unmount();
	});

	it("debounces saves and sends only the last pending offset", async () => {
		authRef.value = true;
		const { api, wrapper } = mountResume(7);

		api.save(400);
		vi.advanceTimersByTime(1000);
		api.save(600);
		vi.advanceTimersByTime(1000);
		api.save(900);
		vi.advanceTimersByTime(2500);

		expect(recordHistory).toHaveBeenCalledTimes(1);
		expect(recordHistory).toHaveBeenCalledWith(7, 900);

		wrapper.unmount();
	});

	it("skips sub-threshold saves while scrolling", async () => {
		authRef.value = true;
		const { api, wrapper } = mountResume(7);

		api.save(40);
		api.save(89);
		vi.advanceTimersByTime(5000);

		expect(recordHistory).not.toHaveBeenCalled();

		wrapper.unmount();
	});

	it("flushes the pending offset on unmount", async () => {
		authRef.value = true;
		const { api, wrapper } = mountResume(7);

		api.save(800);
		// Unmount before the debounce fires — onUnmounted must flush.
		wrapper.unmount();

		expect(recordHistory).toHaveBeenCalledTimes(1);
		expect(recordHistory).toHaveBeenCalledWith(7, 800);
	});

	it("jumpToTop scrolls back to the top, clears the marker, and wipes the saved position", async () => {
		authRef.value = true;
		fetchPosition.mockResolvedValue({ post_id: 7, scroll_position: 1500 });
		const { api, wrapper } = mountResume(7);

		await api.restore();
		expect(api.restoredPosition.value).toBe(1500);

		api.jumpToTop();
		expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
		expect(api.restoredPosition.value).toBeNull();
		// The `0` below the save threshold would never be persisted by the
		// debounced save; jumpToTop must send an explicit clear (DEC-167).
		expect(recordHistory).toHaveBeenCalledWith(7, 0);

		wrapper.unmount();
	});

	it("jumpToTop drops any pending save so a stale offset is not written later", async () => {
		authRef.value = true;
		const { api, wrapper } = mountResume(7);

		api.save(2000); // armed but not yet fired
		api.jumpToTop();
		vi.advanceTimersByTime(5000);

		// Only the explicit clear was sent — the pending 2000 never landed.
		expect(recordHistory).toHaveBeenCalledTimes(1);
		expect(recordHistory).toHaveBeenCalledWith(7, 0);

		wrapper.unmount();
	});

	it("reset() flushes the pending save (not drops it) for an SPA post switch", async () => {
		authRef.value = true;
		fetchPosition.mockResolvedValue({ post_id: 7, scroll_position: 1200 });
		const { api, wrapper } = mountResume(7);

		await api.restore();
		expect(api.restoredPosition.value).toBe(1200);

		api.save(900); // pending, debounce not yet fired
		api.reset();

		expect(api.restoredPosition.value).toBeNull();
		// The old behaviour DROPPED the pending offset here (up to 2.5s of the
		// reader's end-of-article position lost on every SPA post hop); reset()
		// now flushes it immediately so the previous post keeps its resume point.
		expect(recordHistory).toHaveBeenCalledTimes(1);
		expect(recordHistory).toHaveBeenCalledWith(7, 900);
		vi.advanceTimersByTime(5000);
		// The flushed write ate the pending slot — nothing double-sends later.
		expect(recordHistory).toHaveBeenCalledTimes(1);

		wrapper.unmount();
	});

	it("reset() writes the pending offset to the post it belonged to, not the live getter", async () => {
		// The SPA post-switch watcher calls reset() AFTER the id getter already
		// returns the NEXT post; a flush that recomputed the id would tag the old
		// post's offset onto the new post's history row. pendingId must win.
		authRef.value = true;
		const postIdRef = ref(7);
		const Wrapper = defineComponent({
			setup() {
				return { api: useResumeReading(() => postIdRef.value) };
			},
			render: () => h("div"),
		});
		const wrapper = mount(Wrapper);
		const api = (wrapper.vm as unknown as { api: ReturnType<typeof useResumeReading> }).api;

		api.save(900); // pending save recorded against post 7
		postIdRef.value = 8; // reader navigated to post 8
		api.reset();

		expect(recordHistory).toHaveBeenCalledTimes(1);
		expect(recordHistory).toHaveBeenCalledWith(7, 900);

		wrapper.unmount();
	});

	it("reset() clears the dedup register so the next post can save the same pixel", async () => {
		// reset() flushes the old post (advancing lastSaved to its offset); if
		// that register leaked into the next post, a reader who happens to pause
		// at the same pixel would have their new-post save silently suppressed
		// (pos === lastSaved guard) and the server keep the older position.
		authRef.value = true;
		const postIdRef = ref(7);
		const Wrapper = defineComponent({
			setup() {
				return { api: useResumeReading(() => postIdRef.value) };
			},
			render: () => h("div"),
		});
		const wrapper = mount(Wrapper);
		const api = (wrapper.vm as unknown as { api: ReturnType<typeof useResumeReading> }).api;

		api.save(1200); // pending for post 7
		api.reset(); // flushes 1200 → lastSaved = 1200
		expect(recordHistory).toHaveBeenCalledWith(7, 1200);

		// SPA switch to post 8; scroll to the exact same pixel — must not be
		// dropped by post 7's flushed register.
		postIdRef.value = 8;
		api.save(1200);
		vi.advanceTimersByTime(2500);

		expect(recordHistory).toHaveBeenCalledTimes(2);
		expect(recordHistory).toHaveBeenLastCalledWith(8, 1200);

		wrapper.unmount();
	});
});
