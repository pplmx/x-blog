/**
 * Admin Newsletter subscribers page tests (DEC-354, TASK-402).
 *
 * Renders the subscriber table from the admin newsletter API (email, status
 * chip, subscribed date), shows empty/error states and status filters, and
 * removes a subscriber through the confirm dialog (refetching after removal).
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetchResult, mountWithSuspense, stubNuxtGlobals } from "../admin/helpers";

const listMock = vi.fn();
const deleteMock = vi.fn();
const overviewMock = vi.fn();
const triggerMock = vi.fn();

vi.mock("../../api/admin/newsletter", () => ({
	// useAdminNewsletterSubscribers returns an AsyncData-like object the page
	// destructures as { data, pending, error, refresh }.
	useAdminNewsletterSubscribers: (...args: unknown[]) => listMock(...args),
	deleteNewsletterSubscriber: deleteMock,
	// useAdminDigestOverview likewise (DEC-423, TASK-436). The digest panel
	// calls it unconditionally in setup; each describe's beforeEach seeds a
	// default return and individual tests override via overviewMock.
	useAdminDigestOverview: () => overviewMock(),
	triggerWeeklyDigest: triggerMock,
}));

stubNuxtGlobals();

function fakeSubscriber(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: 1,
		email: "alice@example.com",
		is_confirmed: true,
		digest_weekly: false,
		created_at: "2026-07-01T00:00:00Z",
		confirmed_at: "2026-07-01T00:00:01Z",
		...overrides,
	};
}

function fakeListing(items: unknown[]) {
	return mockFetchResult({
		items,
		pagination: { total: items.length, page: 1, limit: 20, total_pages: 1 },
	});
}

let NewsletterPage: unknown;
async function mountPage() {
	NewsletterPage = NewsletterPage ?? (await import("../../app/pages/admin/newsletter.vue")).default;
	return mountWithSuspense(NewsletterPage as never);
}

describe("Admin Newsletter page", () => {
	beforeEach(() => {
		// Re-establish the stubbed Nuxt globals each test relies on (afterEach
		// unstubs them; without this later mounts hang — see admin-readers).
		vi.stubGlobal("definePageMeta", vi.fn());
		stubNuxtGlobals();
		// happy-dom has no window.confirm; the page calls it for the delete
		// confirmation.
		vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
		// The digest panel calls the overview in setup — seed a benign default
		// (empty data) so subscriber-list tests are unaffected.
		overviewMock.mockReturnValue(mockFetchResult(null));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		deleteMock.mockReset();
		overviewMock.mockReset();
		triggerMock.mockReset();
	});

	it("renders the subscriber list with status chips and dates", async () => {
		listMock.mockReturnValue(
			fakeListing([
				fakeSubscriber({ email: "alice@example.com" }),
				fakeSubscriber({ id: 2, email: "bob@example.com", is_confirmed: false }),
				fakeSubscriber({ id: 3, email: "weekly@example.com", digest_weekly: true }),
			]),
		);
		const wrapper = await mountPage();

		expect(wrapper.text()).toContain("alice@example.com");
		expect(wrapper.text()).toContain("bob@example.com");
		expect(wrapper.text()).toContain("已确认"); // confirmed chip (zh default locale)
		expect(wrapper.text()).toContain("待确认"); // pending chip
		// Weekly-digest cadence marker (DEC-355).
		expect(wrapper.text()).toContain("每周摘要");
		// The subscribed date renders (parseApiDate feeds a locale date).
		expect(wrapper.text()).toContain("2026");
	});

	it("shows the empty state when there are no subscribers", async () => {
		listMock.mockReturnValue(fakeListing([]));
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("还没有人订阅");
	});

	it("shows the load-failed state with a retry button when the API errors", async () => {
		listMock.mockReturnValue(mockFetchResult(null, { error: new Error("boom") }));
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("无法加载订阅者列表");
	});

	it("single-flights a slow remove so a double-click cannot re-fire the DELETE", async () => {
		// The per-row busy guard must mark the row in-flight BEFORE the await:
		// previously busyIds.add was never called, so a second click on a slow
		// delete fired a duplicate DELETE (only rescued by the 404-as-success
		// branch). Hold the first delete open and confirm the second tap is a no-op.
		let releaseDelete!: (value: unknown) => void;
		deleteMock.mockImplementation(
			() =>
				new Promise<undefined>((resolve) => {
					releaseDelete = resolve;
				}),
		);
		listMock.mockReturnValue(fakeListing([fakeSubscriber()]));
		const wrapper = await mountPage();

		await wrapper.find("button[aria-label*='alice@example.com']").trigger("click");
		await flushPromises();
		expect(deleteMock).toHaveBeenCalledTimes(1);

		// Second tap while the first is still in flight — must not re-enter.
		const busyButton = wrapper.find("button[aria-label*='alice@example.com']");
		expect(busyButton.attributes("aria-busy")).toBe("true");
		await busyButton.trigger("click");
		await flushPromises();
		expect(deleteMock).toHaveBeenCalledTimes(1);

		releaseDelete(undefined);
		await flushPromises();
		expect(deleteMock).toHaveBeenCalledTimes(1);
	});

	it("removes a subscriber via the confirm dialog and refetches", async () => {
		// Stable object so the page's `refresh` call is addressable after the
		// AsyncData-like destructure.
		const state = {
			data: {
				value: {
					items: [fakeSubscriber()],
					pagination: { total: 1, page: 1, limit: 20, total_pages: 1 },
				},
			},
			pending: { value: false },
			error: { value: null },
			refresh: vi.fn(),
		};
		listMock.mockReturnValue(state);
		deleteMock.mockResolvedValue(undefined);

		const wrapper = await mountPage();
		await wrapper.find("button[aria-label*='alice@example.com']").trigger("click");
		await flushPromises();

		expect(vi.mocked(globalThis.confirm)).toHaveBeenCalled();
		expect(deleteMock).toHaveBeenCalledWith(1);
		expect(state.refresh).toHaveBeenCalled();
	});

	it("switches the status filter and resets to page 1", async () => {
		listMock.mockReturnValue(fakeListing([fakeSubscriber()]));
		const wrapper = await mountPage();

		const confirmed = wrapper.findAll("button").find((b) => b.text().includes("已确认"));
		if (!confirmed) throw new Error("confirmed filter button not rendered");
		await confirmed.trigger("click");
		await flushPromises();

		// The composable received the live refs; the filter change mutates the
		// status ref (and resets the page ref) that drive the useFetch path.
		expect(listMock.mock.calls[0]?.[2].value).toBe("confirmed");
		expect(listMock.mock.calls[0]?.[0].value).toBe(1);
	});

	it("debounces the email search onto the query ref and resets the page", async () => {
		listMock.mockReturnValue(fakeListing([fakeSubscriber()]));
		const wrapper = await mountPage();

		await wrapper.find("input[type='search']").setValue("alice");
		// Wait out the 300ms debounce with real timers, then unmount so the
		// armed timer can never leak into later tests.
		await new Promise((resolve) => setTimeout(resolve, 400));
		await flushPromises();
		wrapper.unmount();

		expect(listMock.mock.calls[0]?.[3].value).toBe("alice");
		expect(listMock.mock.calls[0]?.[0].value).toBe(1);
	});

	it("paginates to page 2 with the next button when more than one page exists", async () => {
		const state = {
			data: {
				value: {
					items: [fakeSubscriber()],
					pagination: { total: 45, page: 1, limit: 20, total_pages: 3 },
				},
			},
			pending: { value: false },
			error: { value: null },
			refresh: vi.fn(),
		};
		listMock.mockReturnValue(state);
		const wrapper = await mountPage();

		const next = wrapper.findAll("button").find((b) => b.text().includes("下一页"));
		if (!next) throw new Error("next button not rendered");
		await next.trigger("click");
		await flushPromises();

		expect(listMock.mock.calls[0]?.[0].value).toBe(2);
	});

	it("keeps the subscriber when the confirm dialog is cancelled", async () => {
		vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
		const state = {
			data: {
				value: {
					items: [fakeSubscriber()],
					pagination: { total: 1, page: 1, limit: 20, total_pages: 1 },
				},
			},
			pending: { value: false },
			error: { value: null },
			refresh: vi.fn(),
		};
		listMock.mockReturnValue(state);

		const wrapper = await mountPage();
		await wrapper.find("button[aria-label*='alice@example.com']").trigger("click");
		await flushPromises();

		expect(deleteMock).not.toHaveBeenCalled();
		expect(state.refresh).not.toHaveBeenCalled();
	});

	it("surfaces a remove error when the delete fails and clears the row busy state", async () => {
		const state = {
			data: {
				value: {
					items: [fakeSubscriber()],
					pagination: { total: 1, page: 1, limit: 20, total_pages: 1 },
				},
			},
			pending: { value: false },
			error: { value: null },
			refresh: vi.fn(),
		};
		listMock.mockReturnValue(state);
		deleteMock.mockRejectedValue(new Error("boom"));

		const wrapper = await mountPage();
		await wrapper.find("button[aria-label*='alice@example.com']").trigger("click");
		await flushPromises();

		expect(wrapper.text()).toContain("boom");
		// The in-flight marker clears so the row can be retried.
		expect(
			wrapper.find("button[aria-label*='alice@example.com']").attributes("disabled"),
		).toBeUndefined();
	});

	it("treats a 404 from remove as already-gone and refetches instead of erroring", async () => {
		const state = {
			data: {
				value: {
					items: [fakeSubscriber()],
					pagination: { total: 1, page: 1, limit: 20, total_pages: 1 },
				},
			},
			pending: { value: false },
			error: { value: null },
			refresh: vi.fn(),
		};
		listMock.mockReturnValue(state);
		deleteMock.mockRejectedValue({ response: { status: 404 } });

		const wrapper = await mountPage();
		await wrapper.find("button[aria-label*='alice@example.com']").trigger("click");
		await flushPromises();

		expect(state.refresh).toHaveBeenCalled();
		expect(wrapper.text()).not.toContain("移除失败");
	});
});

describe("Admin Newsletter digest panel (DEC-423, TASK-436)", () => {
	beforeEach(() => {
		vi.stubGlobal("definePageMeta", vi.fn());
		stubNuxtGlobals();
		overviewMock.mockReset();
		overviewMock.mockReturnValue(fakeOverview());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		overviewMock.mockReset();
		triggerMock.mockReset();
	});

	function fakeOverview(overrides: Partial<Record<string, unknown>> = {}) {
		return mockFetchResult({
			reader_digest_subscribers: 3,
			guest_digest_subscribers: 2,
			last_sent_at: "2026-09-10T00:00:00",
			window_posts: 4,
			...overrides,
		});
	}

	it("renders the digest subscriber counts, last-sent and window posts", async () => {
		listMock.mockReturnValue(fakeListing([]));
		overviewMock.mockReturnValue(fakeOverview());
		const wrapper = await mountPage();

		// Reader + guest subscriber counts on the weekly cadence.
		expect(wrapper.text()).toContain("3");
		expect(wrapper.text()).toContain("2");
		// Window post count.
		expect(wrapper.text()).toContain("4");
		// Last-sent date renders (not blank).
		expect(wrapper.text()).toContain("2026");
	});

	it("renders an unset last-sent state when no digest has ever gone out", async () => {
		listMock.mockReturnValue(fakeListing([]));
		overviewMock.mockReturnValue(fakeOverview({ last_sent_at: null }));
		const wrapper = await mountPage();

		// The never-sent copy replaces a date (not a literal dash).
		expect(wrapper.text()).toContain("尚未发送"); // zh never-sent copy
	});

	it("runs a dry-run preview on the preview button and shows the summary", async () => {
		listMock.mockReturnValue(fakeListing([]));
		overviewMock.mockReturnValue(fakeOverview());
		triggerMock.mockResolvedValue({
			locked: false,
			dry_run: true,
			readers: 3,
			subscribers: 2,
			emails_sent: 0,
			posts: 4,
			skipped: 1,
		});
		const wrapper = await mountPage();

		const preview = wrapper.findAll("button").find((b) => b.text().includes("预览"));
		if (!preview) throw new Error("preview button not rendered");
		await preview.trigger("click");
		await flushPromises();

		expect(triggerMock).toHaveBeenCalledWith(true);
		// The summary surfaces (preview: 3 readers, 2 guests, 4 posts).
		expect(wrapper.text()).toContain("3");
		expect(wrapper.text()).toContain("2");
	});

	it("surfaces a locked / no-recipient preview reason", async () => {
		listMock.mockReturnValue(fakeListing([]));
		overviewMock.mockReturnValue(fakeOverview({ window_posts: 0 }));
		triggerMock.mockResolvedValue({
			locked: false,
			dry_run: true,
			readers: 0,
			subscribers: 0,
			emails_sent: 0,
			posts: 0,
			skipped: 0,
			reason: "no_recipients",
		});
		const wrapper = await mountPage();

		const preview = wrapper.findAll("button").find((b) => b.text().includes("预览"));
		if (!preview) throw new Error("preview button not rendered");
		await preview.trigger("click");
		await flushPromises();

		expect(triggerMock).toHaveBeenCalledWith(true);
		expect(wrapper.text()).toContain("可发送的收件人"); // mapped no_recipients copy
	});

	it("surfaces an error when the trigger call fails", async () => {
		listMock.mockReturnValue(fakeListing([]));
		overviewMock.mockReturnValue(fakeOverview());
		triggerMock.mockRejectedValue(new Error("mail down"));
		const wrapper = await mountPage();

		const preview = wrapper.findAll("button").find((b) => b.text().includes("预览"));
		if (!preview) throw new Error("preview button not rendered");
		await preview.trigger("click");
		await flushPromises();

		expect(wrapper.text()).toContain("mail down");
	});
});
