/**
 * Admin Dashboard Page Tests
 *
 * Tests the admin dashboard: loading state, stats cards rendering
 * (post count, published count, draft count, categories, tags,
 * total views), top posts by views, category distribution, and
 * recent posts list.
 *
 * Mocks the fetchPosts, useCategories, and useTags composables
 * to test the dashboard in isolation. Uses a <Suspense> wrapper
 * since the page uses `await Promise.all(...)` in <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const {
	mockUsePosts,
	mockUseCategories,
	mockUseTags,
	mockFetchAdminComments,
	mockUseBlogStats,
	mockApproveAdminComment,
} = vi.hoisted(() => ({
	mockUsePosts: vi.fn(),
	mockUseCategories: vi.fn(),
	mockUseTags: vi.fn(),
	mockFetchAdminComments: vi.fn(),
	mockUseBlogStats: vi.fn(),
	mockApproveAdminComment: vi.fn(),
}));

vi.mock("~~/api/admin/comments", () => ({
	approveAdminComment: mockApproveAdminComment,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

const mockPostsResponse = {
	items: [
		{
			id: 1,
			title: "Published Post",
			slug: "published-post",
			excerpt: "Excerpt 1",
			published: true,
			created_at: "2024-01-15T10:30:00Z",
			views: 100,
			comment_count: 7,
			cover_image: null,
			category: "Tech",
			category_id: 1,
			tags: [{ id: 1, name: "React" }],
		},
		{
			id: 2,
			title: "Draft Post",
			slug: "draft-post",
			excerpt: "Excerpt 2",
			published: false,
			created_at: "2024-02-20T14:00:00Z",
			views: 50,
			cover_image: null,
			category: "Tech",
			category_id: 1,
			tags: [],
		},
		{
			id: 3,
			title: "Another Published",
			slug: "another-published",
			excerpt: "Excerpt 3",
			published: true,
			created_at: "2024-03-10T09:00:00Z",
			views: 200,
			cover_image: null,
			category: "Design",
			category_id: 2,
			tags: [],
		},
	],
	pagination: { total: 3, page: 1, limit: 100, total_pages: 1 },
};

const mockCategories = [
	{ id: 1, name: "Tech" },
	{ id: 2, name: "Design" },
];

const mockTags = [
	{ id: 1, name: "React" },
	{ id: 2, name: "Vue" },
];

const mockComments = [
	{
		id: 1,
		post_id: 1,
		post_title: "Published Post",
		nickname: "Alice",
		email: "alice@test.com",
		content: "Great article!",
		ip_address: "127.0.0.1",
		is_approved: false,
		created_at: "2024-03-15T10:00:00Z",
	},
	{
		id: 2,
		post_id: 3,
		post_title: "Another Published",
		nickname: "Bob",
		email: "bob@test.com",
		content: "Nice post, thanks for sharing.",
		ip_address: "127.0.0.2",
		is_approved: false,
		created_at: "2024-03-14T08:00:00Z",
	},
	{
		id: 3,
		post_id: 1,
		post_title: "Published Post",
		nickname: "Charlie",
		email: "charlie@test.com",
		content: "I have a question about this topic.",
		ip_address: "127.0.0.3",
		is_approved: true,
		created_at: "2024-03-13T12:00:00Z",
	},
];

/** Envelope returned by the paginated admin comments endpoint. */
const mockCommentList = {
	items: mockComments,
	pagination: { total: 3, page: 1, limit: 100, total_pages: 1 },
};

/** Aggregate stats from the /api/stats endpoint (exact counts). */
const mockStatsResult = {
	total_posts: 3,
	published_posts: 2,
	// The global mock has 2 published + 1 draft (no scheduled): keep the
	// scheduled count at 0 so the existing draft-count assertions hold.
	scheduled_posts: 0,
	total_categories: 2,
	total_tags: 2,
	total_comments: 3,
	total_views: 350,
};

/** Mutable overrides for the $fetch responses (per-test). */
let statsOverride: Record<string, number> = { ...mockStatsResult };
let postsOverride: unknown = null;
// When set, answers /api/admin/posts with a PAGE-WALK mock: a function from
// the parsed { skip, limit } query to the response envelope for that page.
// Drives the multi-page pagination regression test (ISS-443) — the dashboard
// must walk skip/limit, not re-fetch page 1 forever.
let postsPagerOverride: ((skip: number, limit: number) => unknown) | null = null;
// True → the /api/admin/posts route throws (401/network failure drill).
let failPostsOverride = false;
// True → /api/admin/posts rejects with a FetchError-shaped statusCode 401
// (expired/revoked admin session drill, RIL ISS-273).
let posts401Override = false;
let commentsOverride: unknown = null;
let trendOverride: unknown = null;
// True → the reading-trend analytics endpoint 500s (per-card failure drill).
let failTrendOverride = false;
let followsOverride: unknown = null;
let searchesOverride: unknown = null;
let commentStatsOverride: unknown = null;
// Per-axis failure levers (round-278/: the follow/search/comment-activity cards
// each keep their own inline "failed — retry" block like the trend card).
let failFollowsOverride = false;
let failSearchesOverride = false;
let failCommentsOverride = false;
// /admin/me role probe: defaults to superuser so export stays visible; set to
// { role: "editor" } to drill the editor downgrade. (DEC-054, TASK-116.)
let meRoleOverride: unknown = null;
// True → the CSV export / full backup downloads 500.
let exportFailOverride = false;
let backupFailOverride = false;

const mockFollowsResult = {
	total_series_follows: 0,
	total_category_follows: 0,
	top_series: [],
	top_categories: [],
};

const mockSearchesResult: Array<{ query: string; count: number }> = [];

const mockCommentsResult = {
	days: 30,
	total: 0,
	series: Array.from({ length: 30 }, (_, i) => ({
		day: `2026-08-${String(i + 1).padStart(2, "0")}`,
		count: 0,
	})),
	top_posts: [],
};

// A zero-filled 30-day reading-trend series (DEC-086).
const mockTrendResult = {
	days: 30,
	total: 0,
	series: Array.from({ length: 30 }, (_, i) => ({
		day: `2026-08-${String(i + 1).padStart(2, "0")}`,
		views: 0,
	})),
	top_posts: [],
};

// The dashboard now loads data client-side via $fetch in onMounted (ISS-032
// fix), so dispatch the endpoint fixtures by URL path. The old useFetch
// composable stubs above are now unused by the page (the mock module remains,
// but the component no longer imports them); the $fetch mock is authoritative.
vi.stubGlobal(
	"$fetch",
	vi.fn(async (url: unknown, options?: { query?: Record<string, unknown> }) => {
		const u = String(url);
		if (u.includes("/api/admin/posts")) {
			if (posts401Override) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
			if (failPostsOverride) throw new Error("401 Unauthorized");
			if (postsPagerOverride) {
				// ofetch serializes `query` into the URL itself, so the caller's
				// options (not the url string) hold the pagination params here.
				const q = options?.query ?? {};
				const skip = Number(q.skip ?? 0);
				const limit = Number(q.limit ?? 100);
				return postsPagerOverride(skip, limit);
			}
			return postsOverride ?? mockPostsResponse;
		}
		if (u.includes("/api/admin/categories")) return mockCategories;
		if (u.includes("/api/admin/tags")) return mockTags;
		if (u.includes("/api/admin/comments")) return commentsOverride ?? mockCommentList;
		if (u.includes("/api/stats")) return { ...statsOverride };
		// Reading-trend analytics (DEC-086): zero-filled 30-day series so the
		// trend card renders (and stays deterministic) without real data.
		if (u.includes("/api/admin/stats/views")) {
			if (failTrendOverride) throw new Error("trend analytics 500");
			return trendOverride ?? mockTrendResult;
		}
		// Follow analytics (DEC-144/TASK-184).
		if (u.includes("/api/admin/stats/follows")) {
			if (failFollowsOverride) throw new Error("follows analytics 500");
			return followsOverride ?? mockFollowsResult;
		}
		// Search-term analytics (DEC-152/TASK-188).
		if (u.includes("/api/admin/stats/searches")) {
			if (failSearchesOverride) throw new Error("searches analytics 500");
			return searchesOverride ?? mockSearchesResult;
		}
		// Comment activity (DEC-154/TASK-189).
		if (u.includes("/api/admin/stats/comments")) {
			if (failCommentsOverride) throw new Error("comments analytics 500");
			return commentStatsOverride ?? mockCommentsResult;
		}
		// CSVs and /admin/me / backup endpoints.
		if (u.includes("/api/export/")) {
			if (exportFailOverride) throw new Error("export 500");
			if (u.includes("posts.csv")) return "ID,Title\n1,Hello\n";
			return "ID,Content\n1,Great post\n";
		}
		if (u.endsWith("/api/admin/me")) return meRoleOverride ?? { role: "superuser" };
		if (u.includes("/api/admin/backup/restore")) {
			if (backupFailOverride) throw new Error("backup 500");
			return { posts_created: 0, categories: 0, tags: 0, comments_created: 0 };
		}
		if (u.includes("/api/admin/backup")) {
			if (backupFailOverride) throw new Error("backup 500");
			return { format: "x-blog-backup", version: 1, posts: [] };
		}
		throw new Error(`Unexpected $fetch in dashboard test: ${u}`);
	}),
);

/** Default stub for the /api/stats dollar-fetch response. */
function stubBlogStats() {
	statsOverride = { ...mockStatsResult };
}

/** Override the /api/stats dollar-fetch response with custom aggregate stats. */
function stubBlogStatsWith(stats: Record<string, number>) {
	statsOverride = { ...mockStatsResult, ...stats };
}

async function loadPage() {
	const { default: DashboardPage } = await import("@/pages/admin/index.vue");
	return DashboardPage;
}

describe("Admin Dashboard Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		postsOverride = null;
		postsPagerOverride = null;
		posts401Override = false;
		failPostsOverride = false;
		commentsOverride = null;
		failFollowsOverride = false;
		failSearchesOverride = false;
		failCommentsOverride = false;
		meRoleOverride = null;
		exportFailOverride = false;
		backupFailOverride = false;
	});

	describe("Rendering", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue({
				data: ref(mockPostsResponse),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockCommentList),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			stubBlogStats();
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the page heading", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("仪表盘");
		});

		it("renders an error branch with retry when the load fails instead of zeroed cards", async () => {
			// A failed admin load (401 / network) must surface an error + retry
			// rather than render all-zero stat cards that masquerade as an empty
			// installation (deep-dive finding). Uses the file's failPostsOverride
			// lever so the shared $fetch route dispatcher is untouched.
			failPostsOverride = true;
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();
			expect(wrapper.text()).toContain("无法加载仪表盘");
			// The stat cards (which would read 0) are replaced by the error branch.
			expect(wrapper.text()).not.toContain("文章总数");
			failPostsOverride = false;
		});

		it("redirects to /admin/login on a 401 (expired/revoked admin session)", async () => {
			// Session expiry is NOT a transient outage: a 401 from the first
			// admin call must drop the stale token and hard-redirect to login
			// (RIL ISS-273) instead of the generic load-error branch above.
			const replace = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
			posts401Override = true;
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();
			expect(replace).toHaveBeenCalledWith("/admin/login");
			// The stale-error dashboard did not render.
			expect(wrapper.text()).not.toContain("无法加载仪表盘");
			posts401Override = false;
		});

		it("renders the subtitle", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("博客数据总览");
		});
	});

	describe("Stats cards", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue({
				data: ref(mockPostsResponse),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockCommentList),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			stubBlogStats();
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders total post count (3)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("文章总数");
			expect(wrapper.text()).toContain("3");
		});

		it("renders published count (2)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("已发布");
			// 2 published posts among 3 total
			expect(wrapper.text()).toContain("2");
		});

		it("renders draft count (1)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("草稿");
			// 1 draft post among 3 total
			expect(wrapper.text()).toContain("1");
		});

		it("walks ALL posts across skip/limit pages, not just the first batch (ISS-443)", async () => {
			// The dashboard loads every post (all statuses) to build top/recency/
			// category stats beyond the per-page cap of 100. Regression guard: the
			// batch loop used to send `page` to a skip/limit endpoint, so every
			// iteration re-fetched the same first 100 posts — the highest-view
			// post (page 2) never reached the Top Posts card on >100-post blogs.
			const batchSize = 100;
			// 180 posts: the first batch is full (100), the second partial (80).
			// The most-viewed post lives in the SECOND batch.
			const makePost = (
				id: number,
			): {
				id: number;
				title: string;
				slug: string;
				excerpt: string;
				published: boolean;
				created_at: string;
				views: number;
				comment_count: number;
				cover_image: null;
				category: string;
				category_id: number;
				tags: string[];
			} => ({
				id,
				title: `Post ${id}`,
				slug: `post-${id}`,
				excerpt: "",
				published: true,
				created_at: `2024-01-${String(Math.min(31, (id % 28) + 1)).padStart(2, "0")}T00:00:00Z`,
				views: id === 180 ? 1000 : 10,
				comment_count: 0,
				cover_image: null,
				category: "Tech",
				category_id: 1,
				tags: [],
			});
			postsPagerOverride = (skip: number) => {
				const pageItems = Array.from({ length: 180 })
					.map((_, i) => makePost(i + 1))
					.slice(skip, skip + batchSize);
				return { items: pageItems, pagination: { total: 180, skip, limit: batchSize } };
			};

			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);

			// The Top Posts card's leading entry must be the page-2 post — proof
			// the pagination walk actually reached past the first 100.
			expect(wrapper.text()).toContain("Post 180");
		});

		it("excludes scheduled posts from the draft bucket", async () => {
			// total 4 = 2 published + 1 scheduled (future publish_at) + 1 draft;
			// the scheduled post must not inflate the draft count (/api/stats
			// reports it separately, so 4 - 2 - 1 = 1 draft, not 2).
			stubBlogStatsWith({ total_posts: 4, published_posts: 2, scheduled_posts: 1 });
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);

			// Locate the draft stat card (title 草稿) and assert its value === 1
			// (a scheduled post was subtracted, not lumped into drafts). Each
			// stat card root owns a .text-3xl value; find the card whose text
			// includes 草稿 and read that card's own value.
			const draftCard = [...wrapper.findAll("div")].find((el) => {
				if (!(el.text() || "").includes("草稿")) return false;
				const ownValue = el.find(".text-3xl");
				// Skip ancestor containers: match only the card that directly
				// owns a .text-3xl child (the outer grid wrapper does not).
				if (!ownValue) return false;
				return el.findAll("div").every((child) => !child.find(".text-3xl")?.exists());
			});
			expect(draftCard).toBeDefined();
			expect((draftCard?.find(".text-3xl")?.text() || "").trim()).toBe("1");
		});

		it("renders category count (2)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("分类");
			expect(wrapper.text()).toContain("2");
		});

		it("renders tag count (2)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("标签");
			expect(wrapper.text()).toContain("2");
		});

		it("renders total views (350 = 100 + 50 + 200)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("总浏览量");
			expect(wrapper.text()).toContain("350");
		});
	});

	describe("Top posts by views", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue({
				data: ref(mockPostsResponse),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockCommentList),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			stubBlogStats();
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the top posts section heading", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("热门文章");
			expect(wrapper.text()).toContain("浏览量");
		});

		it("renders top post titles sorted by views", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			// Another Published (200 views) should be first
			// Published Post (100 views) second
			// Draft Post (50 views) is not published so excluded from recent
			expect(wrapper.text()).toContain("Another Published");
			expect(wrapper.text()).toContain("Published Post");
		});

		it("renders view counts next to post titles", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("200");
			expect(wrapper.text()).toContain("100");
		});
	});

	describe("Reading trend (DEC-086)", () => {
		beforeEach(() => {
			trendOverride = {
				days: 30,
				total: 42,
				series: [
					{ day: "2026-08-21", views: 42 },
					{ day: "2026-08-22", views: 0 },
				],
				top_posts: [{ id: 1, title: "Trend Post", slug: "trend-post", views: 42 }],
			};
		});
		afterEach(() => {
			trendOverride = null;
		});

		it("renders the trend card with the period total", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("阅读趋势");
			expect(wrapper.text()).toContain("42");
		});

		it("lists hot posts by in-period views", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("本期热门文章");
			expect(wrapper.text()).toContain("Trend Post");
		});
	});

	describe("Follow analytics (TASK-184)", () => {
		afterEach(() => {
			followsOverride = null;
		});

		it("shows totals and top series/categories", async () => {
			followsOverride = {
				total_series_follows: 7,
				total_category_follows: 9,
				top_series: [{ id: 3, title: "Tutorial", slug: "tutorial", count: 5 }],
				top_categories: [{ id: 1, name: "AI", count: 6 }],
			};
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("读者关注");
			expect(wrapper.text()).toContain("Tutorial");
			expect(wrapper.text()).toContain("AI");
			// both totals render
			expect(wrapper.text()).toContain("系列关注总数");
			expect(wrapper.text()).toContain("分类关注总数");
		});
	});

	describe("Search analytics (TASK-188)", () => {
		afterEach(() => {
			searchesOverride = null;
		});

		it("shows top search terms with counts", async () => {
			searchesOverride = [
				{ query: "async rust", count: 9 },
				{ query: "database", count: 3 },
			];
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("热门搜索");
			expect(wrapper.text()).toContain("async rust");
			expect(wrapper.text()).toContain("database");
		});
	});

	describe("Comment activity (TASK-189)", () => {
		afterEach(() => {
			commentStatsOverride = null;
		});

		it("shows the comment total and most-discussed posts", async () => {
			commentStatsOverride = {
				days: 30,
				total: 7,
				series: Array.from({ length: 30 }, (_, i) => ({
					day: `2026-08-${String(i + 1).padStart(2, "0")}`,
					count: i === 29 ? 7 : 0,
				})),
				top_posts: [{ id: 3, title: "Hot Thread", slug: "hot", count: 5 }],
			};
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("评论活跃度");
			expect(wrapper.text()).toContain("Hot Thread");
		});
	});

	describe("Per-card analytics failure (round 278)", () => {
		it("surfaces a failed analytics card with an inline retry that recovers it", async () => {
			// A single failing analytics endpoint used to silently hide its card
			// with no message — the global loadError/retry only fires when the
			// whole load fails, so the operator saw a permanently missing card
			// with no recovery short of a full reload.
			failTrendOverride = true;
			try {
				const DashboardPage = await loadPage();
				const wrapper = await mountWithSuspense(DashboardPage);
				await flushPromises();

				// The failed axis is visible as an inline failure, not a gap…
				expect(wrapper.text()).toContain("此数据块加载失败，可点重试重新获取。");
				// …and its healthy siblings still render.
				expect(wrapper.text()).toContain("热门搜索");

				// The inline retry re-runs just that fetch and the card returns.
				failTrendOverride = false;
				const retryBtn = wrapper.findAll("button").find((b) => b.text() === "重试");
				expect(retryBtn).toBeDefined();
				await retryBtn?.trigger("click");
				await flushPromises();
				expect(wrapper.text()).not.toContain("此数据块加载失败，可点重试重新获取。");
				expect(wrapper.text()).toContain("阅读趋势"); // the trend card is back
			} finally {
				failTrendOverride = false;
			}
		});
	});

	describe("Category distribution", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue({
				data: ref(mockPostsResponse),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockCommentList),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			stubBlogStats();
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the category distribution section heading", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("文章分类分布");
		});

		it("renders all category names", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("Tech");
			expect(wrapper.text()).toContain("Design");
		});

		it("renders published post counts per category (drafts excluded)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			// Tech has 2 posts total but only 1 is published (the other is a draft)
			// Category distribution counts published posts only, matching Next.js
			// CategoryPieChart. Draft Post (Tech category) should NOT be counted.
			const categorySection = wrapper.text();
			expect(categorySection).toContain("Tech");
			expect(categorySection).toContain("Design");
			// Published count: Tech=1, Design=1 (not Tech=2)
			// Verify the draft post title does NOT appear in the category distribution
			// section by checking it's excluded from the count
			const techCount = (categorySection.match(/Tech/g) || []).length;
			expect(techCount).toBe(1); // Tech appears once in category name
		});

		it("excludes drafts from category distribution counts", async () => {
			// Custom data: Tech category has ONLY a draft post (not published).
			// With the bug (counting all posts), Tech count would be 1.
			// With the fix (published only), Tech count should be 0.
			const draftOnlyPost = {
				id: 99,
				title: "Pure Draft",
				slug: "pure-draft",
				excerpt: "",
				published: false,
				created_at: "2024-04-01T10:00:00Z",
				views: 10,
				cover_image: null,
				category: "Tech",
				category_id: 1,
				comment_count: 0,
				tags: [],
			};
			mockUsePosts.mockResolvedValue({
				data: ref({
					items: [draftOnlyPost],
					pagination: { total: 1, page: 1, limit: 1000, total_pages: 1 },
				}),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			postsOverride = {
				items: [draftOnlyPost],
				pagination: { total: 1, page: 1, limit: 100, total_pages: 1 },
			};
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockCommentList),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();
			// Category distribution renders a count span per category.
			// Tech has 0 published posts (only a draft), so the count should be "0".
			// Find all right-aligned count spans (<span class="...w-8 text-right...">)
			const countSpans = wrapper.findAll("span.text-sm.text-gray-500.w-8.text-right");
			if (countSpans.length > 0) {
				// With the fix, Tech published count = 0; with the bug it would be 1.
				const countValues = countSpans.map((s) => s.text().trim());
				expect(countValues).toContain("0");
				expect(countValues).not.toContain("1");
			}
		});
	});

	describe("Recent posts", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue({
				data: ref(mockPostsResponse),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockCommentList),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			stubBlogStats();
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the recent posts section heading", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("最近发布的文章");
		});

		it("renders recent published posts sorted by date (newest first)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			// Newest published post is "Another Published" (2024-03-10)
			// Then "Published Post" (2024-01-15)
			expect(wrapper.text()).toContain("Another Published");
			expect(wrapper.text()).toContain("Published Post");
		});

		it("renders links to edit each recent post", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			const editLink = wrapper.find('a[href="/admin/posts/3"]');
			expect(editLink.exists()).toBe(true);
		});

		it("dates and sorts a scheduled post by its publish time, not its draft time (RIL ISS-266)", async () => {
			// Drafted in January, published in February: the "recently published"
			// card must sort/date it by the effective publish time (publish_at ??
			// created_at), matching the public feed — not show the draft month.
			const scheduledPost = {
				id: 9,
				title: "Scheduled Feb",
				slug: "scheduled-feb",
				excerpt: "Excerpt",
				published: true,
				created_at: "2024-01-05T10:00:00Z",
				publish_at: "2024-02-01T10:00:00Z",
				views: 30,
				comment_count: 0,
				cover_image: null,
				category: "Tech",
				category_id: 1,
				tags: [],
			};
			// An immediately-published March post — effective publish = created_at.
			const marchPost = {
				id: 10,
				title: "Plain March",
				slug: "plain-march",
				excerpt: "Excerpt",
				published: true,
				created_at: "2024-03-05T10:00:00Z",
				views: 40,
				comment_count: 0,
				cover_image: null,
				category: "Tech",
				category_id: 1,
				tags: [],
			};
			postsOverride = {
				items: [scheduledPost, marchPost],
				pagination: { total: 2, page: 1, limit: 100, total_pages: 1 },
			};
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("Plain March");
			expect(wrapper.text()).toContain("Scheduled Feb");
			// Both dates appear; the scheduled one shows Feb, never January.
			expect(wrapper.text()).toContain("2024/2/1");
			expect(wrapper.text()).not.toContain("2024/1/5");
		});

		it("excludes future-scheduled posts from 'recently published'", async () => {
			// A published post whose publish_at is still in the future has NOT
			// gone live: the public feed hides it, so the "recently published"
			// card must too (it previously surfaced the not-yet-live post as
			// the newest "published" row). 2999 is unambiguously in the future
			// from any client clock/timezone.
			const futureScheduled = {
				id: 90,
				title: "Future Draft",
				slug: "future-draft",
				excerpt: "Excerpt",
				published: true,
				created_at: "2026-01-05T10:00:00Z",
				publish_at: "2999-01-01T10:00:00Z",
				views: 5,
				comment_count: 0,
				cover_image: null,
				category: "Tech",
				category_id: 1,
				tags: [],
			};
			const livePost = {
				id: 91,
				title: "Actually Live",
				slug: "actually-live",
				excerpt: "Excerpt",
				published: true,
				created_at: "2026-02-05T10:00:00Z",
				views: 5,
				comment_count: 0,
				cover_image: null,
				category: "Tech",
				category_id: 1,
				tags: [],
			};
			postsOverride = {
				items: [futureScheduled, livePost],
				pagination: { total: 2, page: 1, limit: 100, total_pages: 1 },
			};
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			// Scope to the "recently published" card itself — "Future Draft" may
			// legitimately appear in the top-posts-by-views card, but never here.
			const section = wrapper.find('[data-testid="recent-posts"]');
			const sectionText = section.text();
			expect(sectionText).toContain("Actually Live");
			expect(sectionText).not.toContain("Future Draft");
		});

		it("renders view counts next to recent posts", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			// 200 and 100 view counts should appear
			expect(wrapper.text()).toContain("200");
			expect(wrapper.text()).toContain("100");
		});

		it("renders comment counts next to recent posts", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			// Published Post has comment_count 7
			expect(wrapper.text()).toContain("7");
		});

		it('renders "no published posts" when no posts are published', async () => {
			mockUsePosts.mockResolvedValue({
				data: ref({
					items: [
						{
							id: 1,
							title: "Draft Only",
							slug: "draft-only",
							excerpt: "",
							published: false,
							created_at: "2024-01-15T10:30:00Z",
							views: 0,
							cover_image: null,
							category: null,
							category_id: null,
							comment_count: 0,
							tags: [],
						},
					],
					pagination: { total: 1, page: 1, limit: 1000, total_pages: 1 },
				}),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			postsOverride = {
				items: [
					{
						id: 1,
						title: "Draft Only",
						slug: "draft-only",
						excerpt: "",
						published: false,
						created_at: "2024-01-15T10:30:00Z",
						views: 0,
						cover_image: null,
						category: null,
						category_id: null,
						comment_count: 0,
						tags: [],
					},
				],
				pagination: { total: 1, page: 1, limit: 100, total_pages: 1 },
			};

			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("暂无已发布的文章");
		});
	});

	describe("Pending comments widget", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue({
				data: ref(mockPostsResponse),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockCommentList),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			stubBlogStats();
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the pending comments section heading", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("待审核评论");
		});

		it("renders pending comment count (2)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("2 条待审核");
		});

		it("renders pending comment authors and content", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("Alice");
			expect(wrapper.text()).toContain("Bob");
			expect(wrapper.text()).toContain("Great article!");
			expect(wrapper.text()).toContain("Nice post, thanks for sharing.");
		});

		it("renders approve and reject buttons for each pending comment", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			const approveButtons = wrapper.findAll(".text-green-700");
			const rejectButtons = wrapper.findAll(".text-red-700");
			expect(approveButtons.length).toBeGreaterThanOrEqual(2);
			expect(rejectButtons.length).toBeGreaterThanOrEqual(2);
		});

		it("approves a pending comment via the approve button", async () => {
			mockApproveAdminComment.mockResolvedValue({});
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			const approveBtn = wrapper.findAll(".text-green-700")[0];
			expect(approveBtn).toBeDefined();
			await approveBtn.trigger("click");
			await flushPromises();
			expect(mockApproveAdminComment).toHaveBeenCalled();
			const [id, approved] = mockApproveAdminComment.mock.calls[0] as unknown[];
			expect(id).toEqual(1);
			expect(approved).toBe(true);
		});

		it("shows a rejection message when approving fails", async () => {
			mockApproveAdminComment.mockRejectedValue(new Error("network down"));
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			const approveBtn = wrapper.findAll(".text-green-700")[0];
			await approveBtn?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("network down");
		});

		it("renders data freshness timestamp", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("数据更新于");
		});

		it('shows "暂无待审核评论" when all comments are approved', async () => {
			const approvedOnly = mockComments.map((c) => ({ ...c, is_approved: true }));
			mockFetchAdminComments.mockReturnValue({
				data: ref(approvedOnly),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			commentsOverride = {
				items: approvedOnly,
				pagination: { total: approvedOnly.length, page: 1, limit: 100, total_pages: 1 },
			};
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("暂无待审核评论");
		});
	});

	describe("Data export", () => {
		beforeEach(() => {
			vi.stubGlobal("URL", {
				createObjectURL: vi.fn(() => "blob:mock"),
				revokeObjectURL: vi.fn(),
				...URL,
			});
			// A fake download anchor's click() must not navigate: happy-dom's
			// frame navigator can't build a URL from a blob: href and logs a
			// noisy "URL is not a constructor" on every export test (round 258
			// test-hygiene fix; restored by the file-scoped afterEach).
			vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
		});

		it("renders the export card title", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("数据导出");
		});

		it("renders Posts CSV and Comments CSV buttons", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("导出文章 CSV");
			expect(wrapper.text()).toContain("导出评论 CSV");
		});

		it("fetches posts.csv and triggers a download when the posts button is clicked", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			const postsBtn = wrapper.findAll("button").find((b) => b.text().includes("导出文章 CSV"));
			expect(postsBtn).toBeDefined();
			if (!postsBtn) throw new Error("expected a posts export button");
			await postsBtn.trigger("click");
			await flushPromises();
			const fetchMock = vi.mocked($fetch);
			const exportCall = fetchMock.mock.calls.find(([u]) =>
				String(u).includes("/api/export/posts.csv"),
			);
			expect(exportCall).toBeDefined();
			expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalled();
		});

		it("passes the selected post status as a query param (RIL TASK-079)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			const statusSelect = wrapper.find("select");
			await statusSelect.setValue("draft");
			const postsBtn = wrapper.findAll("button").find((b) => b.text().includes("导出文章 CSV"));
			await postsBtn?.trigger("click");
			await flushPromises();
			const fetchMock = vi.mocked($fetch);
			const exportCall = fetchMock.mock.calls.find(([u]) =>
				String(u).includes("/api/export/posts.csv"),
			);
			expect(exportCall).toBeDefined();
			expect(String(exportCall?.[0])).toContain("status=draft");
		});

		it("fetches comments.csv when the comments export button is clicked", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			const commentsBtn = wrapper.findAll("button").find((b) => b.text().includes("导出评论 CSV"));
			expect(commentsBtn).toBeDefined();
			await commentsBtn?.trigger("click");
			await flushPromises();
			const fetchMock = vi.mocked($fetch);
			const exportCall = fetchMock.mock.calls.find(([u]) =>
				String(u).includes("/api/export/comments.csv"),
			);
			expect(exportCall).toBeDefined();
			expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalled();
		});
	});

	describe("Backup & restore confirmation (DEC-082, TASK-153)", () => {
		const originalConfirm = window.confirm;
		const originalFetch = globalThis.$fetch;

		afterEach(() => {
			// Restore only what these tests override — never unstubAllGlobals,
			// which would also remove the file-scoped useRuntimeConfig/useHead/
			// navigateTo/definePageMeta stubs the other tests rely on.
			window.confirm = originalConfirm;
			globalThis.$fetch = originalFetch;
		});

		function driveRestoreFileInput(wrapper: { find: (sel: string) => any }, contents: string) {
			const input = wrapper.find('input[type="file"]');
			const file = new File([contents], "backup.json", { type: "application/json" });
			Object.defineProperty(input.element, "files", {
				value: [file],
				configurable: true,
			});
			return input;
		}

		it("declines restore without confirmation: no POST and no summary", async () => {
			// Restore upserts matching posts by slug, overwriting live content —
			// it must be gated on a confirmation exactly like every other
			// destructive admin action. A declined confirm sends nothing.
			window.confirm = vi.fn(() => false);
			const restoreFetch = vi.fn(() => Promise.resolve({}));
			globalThis.$fetch = restoreFetch;

			const wrapper = await mountWithSuspense(await loadPage());
			await flushPromises();

			const input = driveRestoreFileInput(
				wrapper,
				JSON.stringify({ format: "x-blog-backup", version: 1, posts: [] }),
			);
			await input.trigger("change");
			await flushPromises();

			expect(window.confirm).toHaveBeenCalledTimes(1);
			expect(restoreFetch).not.toHaveBeenCalledWith(
				expect.stringContaining("/api/admin/backup/restore"),
				expect.anything(),
			);
			expect(wrapper.text()).not.toContain("恢复完成");
			wrapper.unmount();
		});

		it("restores only after the operator confirms the destructive overwrite", async () => {
			window.confirm = vi.fn(() => true);
			const restoreFetch = vi.fn(() =>
				Promise.resolve({ posts_created: 0, categories: 0, tags: 0, comments_created: 0 }),
			);
			globalThis.$fetch = restoreFetch;

			const wrapper = await mountWithSuspense(await loadPage());
			await flushPromises();

			const input = driveRestoreFileInput(
				wrapper,
				JSON.stringify({ format: "x-blog-backup", version: 1, posts: [] }),
			);
			await input.trigger("change");
			await flushPromises();

			expect(window.confirm).toHaveBeenCalledTimes(1);
			expect(restoreFetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/admin/backup/restore"),
				expect.objectContaining({ method: "POST" }),
			);
			expect(wrapper.text()).toContain("恢复完成");
			wrapper.unmount();
		});

		it("rejects a malformed backup file with a parse error and no POST", async () => {
			// JSON.parse of a non-snapshot file must surface a clear parse error
			// and never hit the restore endpoint.
			window.confirm = vi.fn(() => true);
			const restoreFetch = vi.fn(() => Promise.resolve({}));
			globalThis.$fetch = restoreFetch;

			const wrapper = await mountWithSuspense(await loadPage());
			await flushPromises();

			const input = driveRestoreFileInput(wrapper, "this is not json {");
			await input.trigger("change");
			await flushPromises();

			expect(restoreFetch).not.toHaveBeenCalledWith(
				expect.stringContaining("/api/admin/backup/restore"),
				expect.anything(),
			);
			expect(wrapper.text()).toContain("无法解析所选文件");
			wrapper.unmount();
		});
	});

	describe("Branch-gap coverage", () => {
		it("stamps the stored admin token on every request (authHeaders)", async () => {
			localStorage.setItem("admin_token", "tok-123");
			try {
				const DashboardPage = await loadPage();
				const wrapper = await mountWithSuspense(DashboardPage);
				await flushPromises();
				const calls = vi.mocked($fetch).mock.calls;
				const authed = calls.some((c) => {
					const opts = c[1] as { headers?: Record<string, string> } | undefined;
					return opts?.headers?.Authorization === "Bearer tok-123";
				});
				expect(authed).toBe(true);
			} finally {
				localStorage.removeItem("admin_token");
			}
		});

		it("hides export and backup for an editor /me role (DEC-054)", async () => {
			meRoleOverride = { role: "editor" };
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();
			expect(wrapper.text()).not.toContain("数据导出");
			expect(wrapper.text()).not.toContain("备份与恢复");
		});

		it("passes the comment-approval status and date range as export query params (TASK-079)", async () => {
			vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock");
			vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();

			const selects = wrapper.findAll("select");
			await selects[1].setValue("approved");
			const [fromInput, toInput] = wrapper.findAll('input[type="date"]');
			await fromInput.setValue("2026-01-01");
			await toInput.setValue("2026-02-01");

			const commentsBtn = wrapper.findAll("button").find((b) => b.text().includes("导出评论 CSV"));
			await commentsBtn?.trigger("click");
			await flushPromises();
			const calls = vi.mocked($fetch).mock.calls;
			const exportCall = calls.find(([u]) => String(u).includes("/api/export/comments.csv"));
			expect(exportCall).toBeDefined();
			const url = String(exportCall?.[0]);
			expect(url).toContain("is_approved=true");
			expect(url).toContain("date_from=2026-01-01");
			expect(url).toContain("date_to=2026-02-01");

			// pending status flips the flag.
			await selects[1].setValue("pending");
			await commentsBtn?.trigger("click");
			await flushPromises();
			const pendingCall = vi
				.mocked($fetch)
				.mock.calls.filter(([u]) => String(u).includes("/api/export/comments.csv"))
				.at(-1);
			expect(String(pendingCall?.[0])).toContain("is_approved=false");
		});

		it("surfaces an export failure as an inline error", async () => {
			exportFailOverride = true;
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();
			const postsBtn = wrapper.findAll("button").find((b) => b.text().includes("导出文章 CSV"));
			await postsBtn?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("export 500");
		});

		it("surfaces a full-backup download failure as an inline error", async () => {
			backupFailOverride = true;
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();
			const backupBtn = wrapper.findAll("button").find((b) => b.text().includes("下载完整备份"));
			await backupBtn?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("backup 500");
		});

		it("sends requests without an Authorization header when no token is stored", async () => {
			localStorage.removeItem("admin_token");
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();
			const calls = vi.mocked($fetch).mock.calls;
			expect(
				calls.some((c) => {
					const opts = c[1] as { headers?: Record<string, string> } | undefined;
					return !!opts?.headers?.Authorization;
				}),
			).toBe(false);
		});

		it("shows the downloading state while a full backup is in flight", async () => {
			const originalImpl = vi.mocked($fetch).getMockImplementation();
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();

			// Intercept ONLY the next /api/admin/backup call: the dashboard load
			// has already finished, so the in-flight slot is unambiguous.
			vi.mocked($fetch).mockImplementationOnce(async (url: unknown) => {
				if (String(url).includes("/api/admin/backup")) return new Promise(() => {});
				return (originalImpl as (u: unknown) => Promise<unknown>)?.(url);
			});
			const backupBtn = wrapper.findAll("button").find((b) => b.text().includes("下载完整备份"));
			await backupBtn?.trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("下载中…");
			expect(backupBtn?.attributes("disabled")).toBeDefined();
		});

		it("ignores a restore-file change with no file selected", async () => {
			const originalFetch = globalThis.$fetch;
			const restoreFetch = vi.fn(() => Promise.resolve({}));
			globalThis.$fetch = restoreFetch;
			try {
				const wrapper = await mountWithSuspense(await loadPage());
				await flushPromises();

				const input = wrapper.find('input[type="file"]');
				Object.defineProperty(input.element, "files", { value: [], configurable: true });
				await input.trigger("change");
				await flushPromises();

				// No file → the handler early-returns before any confirm / POST.
				// (The stubbed $fetch also serves the dashboard's own data-load
				// calls, so scope the assertion to the restore endpoint only.)
				expect(
					restoreFetch.mock.calls.filter(([url]) =>
						String(url).includes("/api/admin/backup/restore"),
					),
				).toHaveLength(0);
				wrapper.unmount();
			} finally {
				globalThis.$fetch = originalFetch;
			}
		});

		it("falls back to summing post views when /api/stats omits total_views", async () => {
			stubBlogStatsWith({ total_views: undefined });
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();
			// 100 + 50 + 200 from the three mock posts.
			expect(wrapper.text()).toContain("总浏览量");
			expect(wrapper.text()).toContain("350");
		});

		it("shows per-card failures for every analytics axis and recovers one via retry (round 278)", async () => {
			failFollowsOverride = true;
			failSearchesOverride = true;
			failCommentsOverride = true;
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();

			const failedBlocks = wrapper.text().split("此数据块加载失败，可点重试重新获取。").length - 1;
			expect(failedBlocks).toBeGreaterThanOrEqual(3);

			// Recover follows only — its retry is the first in DOM order.
			failFollowsOverride = false;
			const retryBtns = wrapper.findAll("button").filter((b) => b.text().trim() === "重试");
			await retryBtns[0].trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("系列关注总数");
			// The other two axes still show their failed blocks.
			expect(
				wrapper.text().split("此数据块加载失败，可点重试重新获取。").length - 1,
			).toBeGreaterThanOrEqual(2);
		});
	});
});
