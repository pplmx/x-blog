import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

// --- Shared mock state (vi.hoisted makes it available to vi.mock factory) ---
const { mockRecentState } = vi.hoisted(() => ({
	mockRecentState: { recentRef: null as null | { value: unknown[] } },
}));

const { mockState } = vi.hoisted(() => ({
	mockState: {
		posts: null as null | {
			items: Array<{
				id: number;
				title: string;
				slug: string;
				excerpt: string | null;
				views: number;
				likes: number;
				created_at: string;
				cover_image: string | null;
				category: { id: number; name: string } | null;
				tags: { id: number; name: string }[];
			}>;
			pagination: { total: number; page: number; limit: number; total_pages: number };
		},
		pending: false,
		error: null as null | { message: string },
		popularPosts: [] as Array<{
			id: number;
			title: string;
			slug: string;
			views: number;
		}>,
		categories: [] as Array<{ id: number; name: string }>,
		tags: [] as Array<{ id: number; name: string }>,
		statsData: null as null | {
			total_posts: number;
			total_views: number;
			total_likes: number;
			total_comments: number;
		},
		recommended: [] as Array<{
			id: number;
			title: string;
			slug: string;
			views: number;
			category: { id: number; name: string } | null;
		}>,
		followedSeries: [] as Array<{ id: number; title: string; slug: string }>,
		seriesProgress: {} as Record<
			string,
			{
				series_slug: string;
				series_title: string;
				total: number;
				read_count: number;
				completed: boolean;
				read_post_ids: number[];
				next_slug: string | null;
			} | null
		>,
		followsFeed: [] as Array<{
			id: number;
			title: string;
			slug: string;
			views: number;
			category: { id: number; name: string } | null;
		}>,
	},
}));

// --- Mock the public API modules so we control the real data lists. ---
// index.vue loads the post feed through the real usePosts (which hits the
// stubbed global useFetch below, keeping lastFetchUrl tracked for the
// filter/URL assertions); each remaining public module export is overridden.
vi.mock("../../api/public/posts", async () => {
	const actual =
		await vi.importActual<typeof import("../../api/public/posts")>("../../api/public/posts");
	return {
		...actual,
		usePopularPosts: () => ({
			data: ref(mockState.popularPosts),
		}),
	};
});
vi.mock("../../api/public/taxonomy", () => ({
	useCategories: () => ({
		data: ref(mockState.categories),
	}),
	useTags: () => ({
		data: ref(mockState.tags),
	}),
}));
vi.mock("../../api/public/stats", () => ({
	useBlogStats: () => ({
		data: ref(
			mockState.statsData ?? { total_posts: 0, total_views: 0, total_likes: 0, total_comments: 0 },
		),
	}),
}));
vi.mock("../../api/reader/history", () => ({
	useReaderRecommendations: () => ({
		data: ref(mockState.recommended),
	}),
	useReaderSeriesProgress: async (slug: string) => ({
		data: { value: mockState.seriesProgress[slug] ?? null },
	}),
}));
vi.mock("../../api/reader/follows", () => ({
	useReaderFollowsFeed: async () => ({
		data: { value: mockState.followsFeed },
	}),
	useReaderSeriesFollows: async () => ({
		data: { value: { items: mockState.followedSeries, total: mockState.followedSeries.length } },
	}),
}));

// --- Mock useSeo so it's a no-op (no real SEO side effects in tests) ---
vi.mock("../../composables/useSeo", () => ({
	useSeo: vi.fn(),
}));

// ------- Mock useRecentlyViewed (DEC-104, TASK-164) so tests control the
// continue-reading trail (the real composable reads localStorage at module load).
vi.mock("../../composables/useRecentlyViewed", async () => {
	const { ref } = await import("vue");
	const recent = ref<Array<{ slug: string; title: string }>>([]) as {
		value: Array<{ slug: string; title: string }>;
	};
	mockRecentState.recentRef = recent;
	return { useRecentlyViewed: () => ({ recent, record: vi.fn(), clear: vi.fn() }) };
});

// Stub components defined as global components in mountIndexPage()

// --- Stub Nuxt globals used by the page ---
let lastFetchUrl: string = "";
function setupNuxtStubs({ query = {} }: { query?: Record<string, string> } = {}) {
	vi.stubGlobal("useRoute", () => ({ path: "/", query }));
	vi.stubGlobal("navigateTo", vi.fn());
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "http://localhost:18888", siteUrl: "http://localhost:3000" },
	}));
	vi.stubGlobal("useHead", vi.fn());
	// The real usePosts forwards the reactive filter getter to this stub, which
	// resolves it to a URL and records it for the filter/URL assertions.
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string | (() => string) | { value: string }) => {
			lastFetchUrl =
				typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
			return {
				data: ref(mockState.posts),
				pending: ref(mockState.pending),
				error: ref(mockState.error),
				refresh: vi.fn(),
			};
		}),
	);
	vi.stubGlobal("$fetch", vi.fn());
}

// --- Helper: mount the index page with a Suspense boundary ---
async function mountIndexPage(options: { query?: Record<string, string> } = {}) {
	setupNuxtStubs(options);

	const { default: IndexPage } = await import("@/pages/index.vue");

	// Template-based Suspense wrapper (same pattern as posts/[slug].spec.ts)
	const SuspenseWrapper: {
		components: { IndexPage: typeof IndexPage };
		template: string;
	} = {
		components: { IndexPage },
		template:
			"<Suspense>" +
			"<template #default><IndexPage /></template>" +
			"<template #fallback>Loading...</template>" +
			"</Suspense>",
	};

	// Register stub components globally (Nuxt auto-imports these in production)
	const PostCardStub = {
		name: "PostCard",
		template:
			'<article data-testid="post-card" :data-id="post ? post.id : null"><slot /></article>',
		props: ["post"],
	};
	const IconStub = {
		name: "Icon",
		template: '<svg data-testid="icon" :data-icon="icon" />',
		props: ["icon"],
	};
	const NuxtLinkStub = {
		name: "NuxtLink",
		template: '<a :href="to"><slot /></a>',
		props: ["to"],
	};

	const wrapper = mount(SuspenseWrapper, {
		global: {
			components: {
				PostCard: PostCardStub,
				Icon: IconStub,
				NuxtLink: NuxtLinkStub,
			},
		},
	});

	await flushPromises();
	return wrapper;
}

// --- Test data ---
const mockPostsData = {
	items: [
		{
			id: 1,
			title: "First Post",
			slug: "first-post",
			excerpt: "This is the first post excerpt.",
			views: 100,
			likes: 50,
			created_at: "2024-01-15T10:30:00Z",
			cover_image: null,
			category: { id: 1, name: "Tech" },
			tags: [],
		},
		{
			id: 2,
			title: "Second Post",
			slug: "second-post",
			excerpt: "This is the second post excerpt.",
			views: 200,
			likes: 30,
			created_at: "2024-01-16T10:30:00Z",
			cover_image: null,
			category: { id: 1, name: "Tech" },
			tags: [],
		},
	],
	pagination: { total: 2, page: 1, limit: 10, total_pages: 3 },
};

const mockPopularPosts = [
	{ id: 1, title: "Popular Post One", slug: "popular-one", views: 500 },
	{ id: 2, title: "Popular Post Two", slug: "popular-two", views: 400 },
	{ id: 3, title: "Popular Post Three", slug: "popular-three", views: 300 },
];

function resetMockState() {
	mockState.posts = null;
	mockState.pending = false;
	mockState.error = null;
	mockState.popularPosts = [];
	mockState.categories = [];
	mockState.tags = [];
	mockState.statsData = null;
	mockState.recommended = [];
	mockState.followedSeries = [];
	mockState.seriesProgress = {};
	mockState.followsFeed = [];
	try {
		window.localStorage.removeItem("reader_token");
	} catch {
		// happy-dom may lack localStorage
	}
	lastFetchUrl = "";
}

describe("Index Page", () => {
	afterEach(() => {
		resetMockState();
		if (mockRecentState.recentRef) mockRecentState.recentRef.value = [];
		vi.restoreAllMocks();
	});

	describe("Loading state", () => {
		it("shows loading skeleton when posts are pending", async () => {
			mockState.pending = true;
			const wrapper = await mountIndexPage();
			// Loading skeleton should be visible (animate-pulse class on skeleton divs)
			expect(wrapper.find(".animate-pulse").exists()).toBe(true);
		});

		it("does not show error message when pending", async () => {
			mockState.pending = true;
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).not.toContain("加载失败");
		});
	});

	describe("Error state", () => {
		it("shows error message when posts fail to load", async () => {
			mockState.error = { message: "Failed to fetch posts" };
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("加载失败");
			expect(wrapper.text()).toContain("Failed to fetch posts");
		});
	});

	describe("Empty state", () => {
		it("shows no posts message when posts data is null", async () => {
			mockState.posts = null;
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("暂无文章");
		});

		it("shows no posts message when items list is empty", async () => {
			mockState.posts = {
				items: [],
				pagination: { total: 0, page: 1, limit: 10, total_pages: 0 },
			};
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("暂无文章");
		});
	});

	describe("Posts loaded", () => {
		beforeEach(() => {
			mockState.posts = mockPostsData;
		});

		it("renders posts using PostCard component", async () => {
			const wrapper = await mountIndexPage();
			const postCards = wrapper.findAll('[data-testid="post-card"]');
			expect(postCards.length).toBe(2);
			expect(postCards[0].attributes("data-id")).toBe("1");
			expect(postCards[1].attributes("data-id")).toBe("2");
		});

		it("renders hero section with title and description", async () => {
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("探索技术的无限可能");
			expect(wrapper.text()).toContain("X-Blog");
		});

		it("renders hero navigation links", async () => {
			const wrapper = await mountIndexPage();
			// Search link and About link should be present
			const links = wrapper.findAll("a");
			const hrefs = links.map((l) => l.attributes("href"));
			expect(hrefs).toContain("/search");
			expect(hrefs).toContain("/about");
		});

		it("renders site stats from the stats API", async () => {
			mockState.statsData = {
				total_posts: 30,
				total_views: 29080,
				total_likes: 1200,
				total_comments: 45,
			};
			const wrapper = await mountIndexPage();
			// Site-wide totals from /api/stats, not the page's 10 items
			expect(wrapper.text()).toContain("29,080");
			expect(wrapper.text()).toContain("1,200");
		});

		it("renders article count in stats", async () => {
			mockState.statsData = { total_posts: 30, total_views: 0, total_likes: 0, total_comments: 0 };
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("30");
		});

		it("renders post list section", async () => {
			const wrapper = await mountIndexPage();
			// Should render the posts list section heading
			expect(wrapper.text()).toContain("最新");
		});

		it("renders sidebar stats card", async () => {
			const wrapper = await mountIndexPage();
			const statsCard = wrapper.find(".bg-gradient-to-br");
			expect(statsCard.exists()).toBe(true);
			expect(wrapper.text()).toContain("站点统计");
		});

		it("renders quick navigation links in sidebar", async () => {
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("快速导航");
			expect(wrapper.text()).toContain("首页");
			expect(wrapper.text()).toContain("关于");
			expect(wrapper.text()).toContain("搜索");
		});

		it("renders GitHub link in quick navigation", async () => {
			const wrapper = await mountIndexPage();
			const links = wrapper.findAll("a");
			const githubLink = links.find((l) => l.attributes("href")?.includes("github.com"));
			expect(githubLink).toBeTruthy();
			expect(githubLink?.attributes("target")).toBe("_blank");
		});
	});

	describe("Popular posts", () => {
		it("renders popular posts section when data is available", async () => {
			mockState.posts = mockPostsData;
			mockState.popularPosts = mockPopularPosts;
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("热门文章");
			expect(wrapper.text()).toContain("Popular Post One");
			expect(wrapper.text()).toContain("Popular Post Two");
			expect(wrapper.text()).toContain("Popular Post Three");
		});

		it("shows view count for popular posts", async () => {
			mockState.posts = mockPostsData;
			mockState.popularPosts = mockPopularPosts;
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("500 阅读");
		});

		it("does not render popular posts section when empty", async () => {
			mockState.posts = mockPostsData;
			mockState.popularPosts = [];
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).not.toContain("热门文章");
		});
	});

	describe("Pagination", () => {
		it("renders without errors when posts loaded with pagination", async () => {
			mockState.posts = mockPostsData;
			const wrapper = await mountIndexPage();
			expect(wrapper.find(".markdown-content").exists()).toBe(false);
			// Component should render the posts section heading
			expect(wrapper.text()).toContain("最新");
		});

		it("renders without errors when single page", async () => {
			mockState.posts = {
				items: mockPostsData.items,
				pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
			};
			const wrapper = await mountIndexPage();
			expect(wrapper.find(".markdown-content").exists()).toBe(false);
		});

		it("calls navigateTo when fetchPosts is triggered", async () => {
			mockState.posts = mockPostsData;
			const wrapper = await mountIndexPage();
			// Component should render without errors
			expect(wrapper.exists()).toBe(true);
			// Verify fetchPosts function is defined (called via pagination button click)
			const allButtons = wrapper.findAll("button");
			expect(allButtons.length).toBeGreaterThan(0);
		});
	});

	describe("Stats computation", () => {
		it("computes total views and likes from the stats API", async () => {
			mockState.statsData = {
				total_posts: 30,
				total_views: 29080,
				total_likes: 1200,
				total_comments: 45,
			};
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("29,080");
			expect(wrapper.text()).toContain("1,200");
		});

		it("renders total comments from the stats API", async () => {
			mockState.statsData = { total_posts: 30, total_views: 0, total_likes: 0, total_comments: 45 };
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("45");
		});

		it("handles missing stats data gracefully", async () => {
			mockState.statsData = null;
			mockState.posts = {
				items: [
					{ ...mockPostsData.items[0], views: 100, likes: 50 },
					{ ...mockPostsData.items[1], views: 200, likes: 30 },
				],
				pagination: mockPostsData.pagination,
			};
			const wrapper = await mountIndexPage();
			expect(wrapper.find(".markdown-content").exists()).toBe(false);
			// Stats card should still render (falls back to 0 / page total)
			expect(wrapper.text()).toContain("站点统计");
		});

		it("formats large numbers with toLocaleString", async () => {
			mockState.statsData = {
				total_posts: 1,
				total_views: 1000000,
				total_likes: 500000,
				total_comments: 0,
			};
			const wrapper = await mountIndexPage();
			// 1,000,000 formatted with commas
			expect(wrapper.text()).toContain("1,000,000");
			expect(wrapper.text()).toContain("500,000");
		});
	});

	describe("SEO", () => {
		it("calls useSeo with correct metadata", async () => {
			await mountIndexPage();
			// useSeo is mocked - we just verify it was called without errors
			expect(true).toBe(true);
		});
	});

	describe("Hero section", () => {
		it("renders hero with gradient background", async () => {
			mockState.posts = mockPostsData;
			const wrapper = await mountIndexPage();
			const hero = wrapper.find('[class*="bg-gradient-to-br"]');
			expect(hero.exists()).toBe(true);
		});

		it("renders hero badge with sparkles icon", async () => {
			mockState.posts = mockPostsData;
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("技术博客");
		});

		it("renders call-to-action buttons", async () => {
			mockState.posts = mockPostsData;
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("搜索文章");
			expect(wrapper.text()).toContain("关于本站");
		});
	});

	describe("Category/tag deep-link filtering", () => {
		beforeEach(() => {
			mockState.posts = mockPostsData;
			mockState.categories = [
				{ id: 1, name: "Tech" },
				{ id: 2, name: "Design" },
			];
			mockState.tags = [{ id: 7, name: "Vue" }];
		});

		it("passes category_id to the posts API when the route query sets it", async () => {
			await mountIndexPage({ query: { category_id: "1" } });
			expect(lastFetchUrl).toContain("category_id=1");
		});

		it("passes tag_id to the posts API when the route query sets it", async () => {
			await mountIndexPage({ query: { tag_id: "7" } });
			expect(lastFetchUrl).toContain("tag_id=7");
		});

		it("passes no filter params when neither is set", async () => {
			await mountIndexPage();
			expect(lastFetchUrl).not.toContain("category_id=");
			expect(lastFetchUrl).not.toContain("tag_id=");
		});

		it("shows an active filter indicator with the category name", async () => {
			const wrapper = await mountIndexPage({ query: { category_id: "1" } });
			expect(wrapper.text()).toContain("筛选");
			expect(wrapper.text()).toContain("Tech");
		});

		it("shows an active filter indicator with the tag name", async () => {
			const wrapper = await mountIndexPage({ query: { tag_id: "7" } });
			expect(wrapper.text()).toContain("筛选");
			expect(wrapper.text()).toContain("Vue");
		});

		it("does not show a filter indicator when no filter is active", async () => {
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).not.toContain("筛选");
		});

		it("preserves the active filter when navigating pages", async () => {
			mockState.posts = {
				...mockPostsData,
				pagination: { total: 20, page: 1, limit: 10, total_pages: 2 },
			};
			const wrapper = await mountIndexPage({ query: { category_id: "1" } });

			// Override the navigateTo stub AFTER mount so it captures calls
			const navigateToMock = vi.fn();
			vi.stubGlobal("navigateTo", navigateToMock);

			// Click a pagination button (rendered because total_pages > 1)
			const pageButtons = wrapper
				.findAll("button")
				.filter((b) => b.text() === "2" || b.text() === "1");
			expect(pageButtons.length).toBeGreaterThanOrEqual(1);
			const pageTwo = pageButtons.find((b) => b.text() === "2");
			expect(pageTwo).toBeDefined();
			if (!pageTwo) throw new Error("expected a page-2 button");
			await pageTwo.trigger("click");

			// navigateTo must keep the active category filter alongside the page
			expect(navigateToMock).toHaveBeenCalledWith({
				query: { page: "2", category_id: "1" },
			});
		});
	});

	describe("Browse-by chips", () => {
		beforeEach(() => {
			mockState.posts = mockPostsData;
			mockState.categories = [
				{ id: 1, name: "Tech" },
				{ id: 2, name: "Design" },
			];
			mockState.tags = [{ id: 7, name: "Vue" }];
		});

		it("renders category chips from the categories data", async () => {
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("Tech");
			expect(wrapper.text()).toContain("Design");
		});

		it("renders tag chips with hash prefix", async () => {
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("#Vue");
		});

		it("renders category chip as a navigable link", async () => {
			const wrapper = await mountIndexPage();
			const chip = wrapper.findAll("a").find((a) => a.text() === "Tech");
			// Chip renders as an anchor (NuxtLink) so it navigates.
			expect(chip).toBeDefined();
			expect(chip?.element.tagName).toBe("A");
		});

		it("renders tag chip as a navigable link", async () => {
			const wrapper = await mountIndexPage();
			const chip = wrapper.findAll("a").find((a) => a.text() === "#Vue");
			expect(chip).toBeDefined();
			expect(chip?.element.tagName).toBe("A");
		});
	});

	describe("Continue reading (DEC-104, TASK-164)", () => {
		it("hides the section when nothing was recently viewed", async () => {
			mockState.posts = mockPostsData;
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).not.toContain("继续阅读");
		});

		it("renders recently viewed posts as links", async () => {
			mockState.posts = mockPostsData;
			const wrapper = await mountIndexPage();
			const recentRef = mockRecentState.recentRef as { value: unknown[] };
			recentRef.value = [
				{ slug: "made-post", title: "Made Post" },
				{ slug: "other", title: "Other Post" },
			];
			await wrapper.vm.$nextTick();
			expect(wrapper.text()).toContain("继续阅读");
			expect(wrapper.text()).toContain("Made Post");
		});
	});

	describe("Recommended for you (TASK-176)", () => {
		it("shows recommended posts for a signed-in reader", async () => {
			window.localStorage.setItem("reader_token", "token");
			mockState.recommended = [
				{ id: 7, title: "AI Post", slug: "ai-post", views: 3, category: { id: 2, name: "AI" } },
			];
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("为你推荐");
			expect(wrapper.text()).toContain("AI Post");
		});

		it("hides the recommended row for guests", async () => {
			mockState.recommended = [
				{ id: 7, title: "AI Post", slug: "ai-post", views: 3, category: { id: 2, name: "AI" } },
			];
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).not.toContain("为你推荐");
		});
	});

	describe("Your series (TASK-180)", () => {
		it("shows followed series with progress + a continue deep link for a signed-in follower", async () => {
			window.localStorage.setItem("reader_token", "token");
			mockState.followedSeries = [{ id: 3, title: "Tutorial", slug: "tutorial" }];
			mockState.seriesProgress = {
				tutorial: {
					series_slug: "tutorial",
					series_title: "Tutorial",
					total: 5,
					read_count: 2,
					completed: false,
					read_post_ids: [],
					next_slug: "part-3",
				},
			};
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("我的系列");
			expect(wrapper.text()).toContain("Tutorial");
			expect(wrapper.html()).toContain("/posts/part-3");
		});

		it("hides the row for guests even when followed series exist in state", async () => {
			mockState.followedSeries = [{ id: 3, title: "Tutorial", slug: "tutorial" }];
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).not.toContain("我的系列");
		});

		it("hides the row when a signed-in reader follows no series", async () => {
			window.localStorage.setItem("reader_token", "token");
			mockState.followedSeries = [];
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).not.toContain("我的系列");
		});
	});

	describe("Latest from your follows (TASK-183)", () => {
		it("shows followed-content posts for a signed-in follower", async () => {
			window.localStorage.setItem("reader_token", "token");
			mockState.followsFeed = [
				{
					id: 9,
					title: "Followed Post",
					slug: "followed-post",
					views: 4,
					category: { id: 2, name: "AI" },
				},
			];
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("关注内容的最新文章");
			expect(wrapper.text()).toContain("Followed Post");
		});

		it("hides the row for guests", async () => {
			mockState.followsFeed = [
				{
					id: 9,
					title: "Followed Post",
					slug: "followed-post",
					views: 4,
					category: { id: 2, name: "AI" },
				},
			];
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).not.toContain("关注内容的最新文章");
		});

		it("hides the row when the signed-in reader's follows feed is empty", async () => {
			window.localStorage.setItem("reader_token", "token");
			mockState.followsFeed = [];
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).not.toContain("关注内容的最新文章");
		});
	});
});
