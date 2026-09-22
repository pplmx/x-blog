/**
 * Admin Dashboard page tests.
 *
 * The pending-comments quick-card regression (TASK-332/ISS-431): the dashboard
 * used to fetch the newest 100 comments and slice out the pending ones, so on
 * a blog with >100 approved comments a pending item parked behind them was
 * invisible on the card while the count badge said pending ≥ 1. It now fetches
 * the moderation queue itself (is_approved=false, limit 5), so the card shows
 * the real newest pending comments regardless of approved volume.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { stubNuxtGlobals } from "../admin/helpers";

vi.stubGlobal("definePageMeta", vi.fn());
vi.stubGlobal("useLang", () => ({ t: (key: string) => key, locale: ref("zh") }));
vi.stubGlobal("useAdminAuth", () => ({ handleAdminUnauthorized: vi.fn() }));

const fetchMock = vi.fn();
let commentsQuery: Record<string, unknown> | undefined;

// The AdminComment shape the dashboard card renders: nickname, post_title,
// content, is_approved.
const pendingComment = {
	id: 99,
	post_id: 1,
	post_title: "Old but pending post",
	nickname: "OldReader",
	content: "A pending comment an old page would never have shown",
	is_approved: false,
};

function apiStub(url: string, options: { query?: Record<string, unknown> } = {}) {
	if (url.endsWith("/api/admin/comments")) {
		commentsQuery = options.query;
		return {
			items: [pendingComment],
			pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
		};
	}
	if (url.endsWith("/api/admin/posts")) {
		return { items: [], pagination: { total: 0, page: 1, limit: 100, total_pages: 0 } };
	}
	if (url.endsWith("/api/admin/categories")) return [];
	if (url.endsWith("/api/admin/tags")) return [];
	if (url.endsWith("/api/stats")) {
		return { total_posts: 0, published_posts: 0, drafts: 0, pending_comments: 0 };
	}
	if (url.includes("/api/admin/stats/views")) {
		return { days: 30, total: 0, series: [], top_posts: [] };
	}
	if (url.includes("/api/admin/stats/follows")) {
		return {
			total_series_follows: 0,
			total_category_follows: 0,
			top_series: [],
			top_categories: [],
		};
	}
	if (url.includes("/api/admin/stats/searches")) return [];
	if (url.includes("/api/admin/stats/comments")) {
		return { days: 30, total: 0, series: [], top_posts: [], pending_count: 1 };
	}
	if (url.endsWith("/api/admin/me")) return { role: "superuser" };
	throw new Error(`Unmocked $fetch URL: ${url}`);
}

describe("Admin Dashboard Page", () => {
	stubNuxtGlobals();

	afterEach(() => {
		vi.restoreAllMocks();
		commentsQuery = undefined;
	});

	async function mountDashboard() {
		fetchMock.mockImplementation(apiStub);
		vi.stubGlobal("$fetch", fetchMock);
		const { default: AdminIndex } = await import("@/pages/admin/index.vue");
		const wrapper = mount(AdminIndex, {
			global: { stubs: { NuxtLink: { template: "<a><slot/></a>" } } },
		});
		await flushPromises();
		return wrapper;
	}

	it("fetches the pending queue, not the newest-100 slice (ISS-431)", async () => {
		const wrapper = await mountDashboard();

		// The regression: the comments fetch asks for pending-only so pending
		// items behind a flood of newer approved comments still surface.
		expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/admin/comments"))).toBe(
			true,
		);
		expect(commentsQuery).toEqual({ page: 1, limit: 5, is_approved: false });

		// The old pending comment is rendered on the quick card.
		expect(wrapper.text()).toContain("OldReader");
		expect(wrapper.text()).toContain("A pending comment an old page would never have shown");
	});

	it("header count shows the authoritative pending count, not the capped 5-row slice (round-424 audit)", async () => {
		// The quick card's header used pendingComments.length — the length of the
		// pending slice fetched with limit 5 — so a blog with more than 5 pending
		// comments showed "N pending" where N was capped by the slice, while the
		// stat card beside it showed the real total: two contradicting moderation
		// signals on one dashboard. The header must use the authoritative
		// pending_count (which the stat card already uses), with the 5-row slice
		// reserved for the list body.
		const api = (url: string, o: Record<string, unknown> = {}) => {
			if (url.endsWith("/api/admin/comments")) {
				commentsQuery = o.query;
				return {
					// Only 2 rows are within the newest pending slice…
					items: [pendingComment, { ...pendingComment, id: 100, nickname: "SecondPending" }],
					pagination: { total: 7, page: 1, limit: 5, total_pages: 2 },
				};
			}
			// …but the stats endpoint says 7 are pending overall.
			if (url.includes("/api/admin/stats/comments")) {
				return { days: 30, total: 0, series: [], top_posts: [], pending_count: 7 };
			}
			return apiStub(url, o);
		};
		fetchMock.mockImplementation(api);
		vi.stubGlobal("$fetch", fetchMock);

		const { default: AdminIndex } = await import("@/pages/admin/index.vue");
		const wrapper = mount(AdminIndex, {
			global: { stubs: { NuxtLink: { template: "<a><slot/></a>" } } },
		});
		await flushPromises();

		// Header reflects the authoritative 7 ("7 条待审核"), NOT the 2-row slice
		// the old `pendingComments.length` would have rendered.
		expect(wrapper.text()).toContain("7 条待审核");
		// And the self-consistency: the header count (7) exceeds the rows shown (2).
		expect(wrapper.text()).toContain("SecondPending");
		expect(wrapper.text()).toContain("OldReader");
	});
});
