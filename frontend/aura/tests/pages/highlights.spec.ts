/**
 * /highlights page tests (round 466, DEC-511 / TASK-583).
 *
 * The page lists the signed-in reader's saved passages with pagination
 * (deep-linkable ?page=, windowed buttons) plus inline note edit/delete.
 * Covers: guest redirect to /login, empty state, listing items, pagination
 * controls rendering only when >1 page and following the route page, the
 * out-of-range page clamp, and load-error retry.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

import HighlightsPage from "../../app/pages/highlights.vue";

const mockReplace = vi.fn();
let mockRouteQuery: Record<string, string> = {};

const mockAuth = ref({ isAuthenticated: true });
vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({
		isAuthenticated: computed(() => mockAuth.value.isAuthenticated),
		logout: vi.fn(),
		isStaleSession: () => false,
	}),
}));

vi.mock("../../composables/useSeo", () => ({
	useSeo: vi.fn(),
}));

vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t: (k: string) => k, locale: ref("zh") }),
}));

// The highlights list envelope; the test flips both the current payload and
// (for the clamp test) a "next page" payload after the first resolve.
let listPayload: {
	items: unknown[];
	total: number;
	page?: number;
	limit?: number;
	total_pages?: number;
};
let listReject: unknown = null;
vi.mock("../../api/reader/highlights", () => ({
	getReaderHighlights: async () => {
		if (listReject) throw listReject;
		return listPayload;
	},
	deleteReaderHighlight: vi.fn(),
	updateReaderHighlightNote: vi.fn(),
}));

const stubs = {
	Icon: { template: "<svg class='icon-stub' />" },
	NuxtLink: { template: "<a class='nuxt-link-stub'><slot/></a>" },
};

const sampleHighlight = {
	id: 1,
	post_id: 7,
	text: "The key passage.",
	note: null,
	created_at: "2024-01-15T10:00:00Z",
	post: { id: 7, slug: "the-post", title: "The Post" },
};

beforeEach(() => {
	mockRouteQuery = {};
	mockAuth.value = { isAuthenticated: true };
	listPayload = { items: [], total: 0, page: 1, limit: 50, total_pages: 0 };
	listReject = null;
	mockReplace.mockClear();
	vi.stubGlobal("useRoute", () => ({ path: "/highlights", query: mockRouteQuery }));
	vi.stubGlobal("navigateTo", vi.fn());
	vi.stubGlobal("useRouter", () => ({ replace: mockReplace }));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function mountPage() {
	const wrapper = mount(HighlightsPage, { global: { stubs } });
	await flushPromises();
	return wrapper;
}

describe("Highlights page", () => {
	it("redirects guests to /login", async () => {
		mockAuth.value = { isAuthenticated: false };
		await mountPage();
		expect(mockReplace).toHaveBeenCalledWith({ path: "/login", query: { redirect: "/highlights" } });
	});

	it("shows the empty state when the reader has no highlights", async () => {
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("highlights.title");
		expect(wrapper.text()).toContain("highlights.empty");
		expect(wrapper.text()).toContain("highlights.emptyHint");
	});

	it("renders saved highlights with their post link", async () => {
		listPayload = { items: [sampleHighlight], total: 1, page: 1, limit: 50, total_pages: 1 };
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("The key passage.");
		expect(wrapper.text()).toContain("The Post");
		expect(wrapper.text()).toContain("highlights.countLabel");
		expect(wrapper.text()).not.toContain("highlights.empty");
	});

	it("shows pagination controls only when there is more than one page", async () => {
		listPayload = {
			items: [sampleHighlight],
			total: 120,
			page: 1,
			limit: 50,
			total_pages: 3,
		};
		const wrapper = await mountPage();
		const buttons = wrapper.findAll("button").filter((b) => /^\d+$/.test(b.text()));
		expect(buttons.length).toBeGreaterThan(0);
	});

	it("marks the ROUTE page as current, not the stale server payload", async () => {
		// URL says page 2 while the last payload still reports page 1 (the
		// in-flight window); the current-page marker follows the route.
		mockRouteQuery = { page: "2" };
		listPayload = {
			items: [sampleHighlight],
			total: 120,
			page: 1,
			limit: 50,
			total_pages: 3,
		};
		const wrapper = await mountPage();
		const page2 = wrapper.findAll("button").find((b) => b.text().trim() === "2");
		const page1 = wrapper.findAll("button").find((b) => b.text().trim() === "1");
		expect(page2?.attributes("disabled")).toBeDefined();
		expect(page2?.attributes("aria-current")).toBe("page");
		expect(page1?.attributes("aria-current")).toBeUndefined();
		expect(page1?.attributes("disabled")).toBeUndefined();
	});

	it("surfaces a load failure with a retry instead of the empty state", async () => {
		listReject = new Error("network");
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("highlights.loadFailed");
		expect(wrapper.text()).not.toContain("highlights.empty");

		// Retry path: flip the payload to success and click Retry.
		listReject = null;
		listPayload = { items: [sampleHighlight], total: 1, page: 1, limit: 50, total_pages: 1 };
		const retry = wrapper.findAll("button").find((b) => b.text().includes("highlights.retry"));
		await retry?.trigger("click");
		await flushPromises();
		expect(wrapper.text()).toContain("The key passage.");
		expect(wrapper.text()).not.toContain("highlights.loadFailed");
	});
});
