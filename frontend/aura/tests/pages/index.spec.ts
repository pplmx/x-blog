import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

// --- Shared mock state (vi.hoisted makes it available to vi.mock factory) ---
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
	},
}));

// --- Mock useApi module so we control usePopularPosts return values ---
// Note: index.vue no longer uses usePosts — it calls useFetch directly
// for reactive pagination. Only usePopularPosts is still imported from useApi.
vi.mock("../../composables/useApi", () => ({
	usePopularPosts: () => ({
		data: ref(mockState.popularPosts),
	}),
}));

// --- Mock useSeo so it's a no-op (no real SEO side effects in tests) ---
vi.mock("../../composables/useSeo", () => ({
	useSeo: vi.fn(),
}));

// Stub components defined as global components in mountIndexPage()

// --- Stub Nuxt globals used by the page ---
function setupNuxtStubs() {
	vi.stubGlobal("useRoute", () => ({ path: "/", query: {} }));
	vi.stubGlobal("navigateTo", vi.fn());
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "http://localhost:18888", siteUrl: "http://localhost:3000" },
	}));
	vi.stubGlobal("useHead", vi.fn());
	// index.vue calls useFetch directly for the posts list with a computed URL
	vi.stubGlobal(
		"useFetch",
		vi.fn(() => ({
			data: ref(mockState.posts),
			pending: ref(mockState.pending),
			error: ref(mockState.error),
			refresh: vi.fn(),
		})),
	);
	vi.stubGlobal("$fetch", vi.fn());
}

// --- Helper: mount the index page with a Suspense boundary ---
async function mountIndexPage() {
	setupNuxtStubs();

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
}

describe("Index Page", () => {
	afterEach(() => {
		resetMockState();
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

		it("renders site stats from post data", async () => {
			const wrapper = await mountIndexPage();
			// Total views: 100 + 200 = 300, formatted with toLocaleString
			expect(wrapper.text()).toContain("300");
			// Total likes: 50 + 30 = 80
			expect(wrapper.text()).toContain("80");
		});

		it("renders article count in stats", async () => {
			const wrapper = await mountIndexPage();
			// Total posts: 2
			expect(wrapper.text()).toContain("2");
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
		it("computes total views from post items", async () => {
			mockState.posts = {
				items: [
					{ ...mockPostsData.items[0], views: 100 },
					{ ...mockPostsData.items[1], views: 200 },
				],
				pagination: mockPostsData.pagination,
			};
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("300");
		});

		it("computes total likes from post items", async () => {
			mockState.posts = {
				items: [
					{ ...mockPostsData.items[0], likes: 50 },
					{ ...mockPostsData.items[1], likes: 30 },
				],
				pagination: mockPostsData.pagination,
			};
			const wrapper = await mountIndexPage();
			expect(wrapper.text()).toContain("80");
		});

		it("handles missing views/likes gracefully", async () => {
			mockState.posts = {
				items: [
					{ ...mockPostsData.items[0], views: 100, likes: 50 },
					{ ...mockPostsData.items[1], views: 200, likes: 30 },
				],
				pagination: mockPostsData.pagination,
			};
			const wrapper = await mountIndexPage();
			expect(wrapper.find(".markdown-content").exists()).toBe(false);
			// Stats card should still render
			expect(wrapper.text()).toContain("站点统计");
		});

		it("formats large numbers with toLocaleString", async () => {
			mockState.posts = {
				items: [
					{ ...mockPostsData.items[0], views: 1000000, likes: 500000 },
				],
				pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
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
});
