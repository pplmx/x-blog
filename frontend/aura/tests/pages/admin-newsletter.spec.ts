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

vi.mock("../../api/admin/newsletter", () => ({
	// useAdminNewsletterSubscribers returns an AsyncData-like object the page
	// destructures as { data, pending, error, refresh }.
	useAdminNewsletterSubscribers: (...args: unknown[]) => listMock(...args),
	deleteNewsletterSubscriber: deleteMock,
}));

stubNuxtGlobals();

function fakeSubscriber(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: 1,
		email: "alice@example.com",
		is_confirmed: true,
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
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		deleteMock.mockReset();
	});

	it("renders the subscriber list with status chips and dates", async () => {
		listMock.mockReturnValue(
			fakeListing([
				fakeSubscriber({ email: "alice@example.com" }),
				fakeSubscriber({ id: 2, email: "bob@example.com", is_confirmed: false }),
			]),
		);
		const wrapper = await mountPage();

		expect(wrapper.text()).toContain("alice@example.com");
		expect(wrapper.text()).toContain("bob@example.com");
		expect(wrapper.text()).toContain("已确认"); // confirmed chip (zh default locale)
		expect(wrapper.text()).toContain("待确认"); // pending chip
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
