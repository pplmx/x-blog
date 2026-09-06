import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { resetAdminPostListState } from "../../composables/adminPostListState";
import { mountWithSuspense } from "./helpers.ts";

const { mockFetchAdminPosts, mockDeleteAdminPost } = vi.hoisted(() => ({
	mockFetchAdminPosts: vi.fn(),
	mockDeleteAdminPost: vi.fn(),
}));

vi.mock("~~/api/admin/posts", () => ({
	useAdminPosts: mockFetchAdminPosts,
	deleteAdminPost: mockDeleteAdminPost,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

const originalConfirm = window.confirm;

const mockResponse = {
	items: [
		{
			id: 1,
			title: "First Post",
			slug: "first-post",
			published: true,
			pinned: false,
			publish_at: null,
			views: 100,
			cover_image: null,
			category: "Tech",
			tags: ["React"],
			created_at: "2024-01-15T10:30:00Z",
			updated_at: "2024-01-15T10:30:00Z",
		},
		{
			id: 2,
			title: "Draft Post",
			slug: "draft-post",
			published: false,
			pinned: false,
			publish_at: null,
			views: 0,
			cover_image: null,
			category: "Design",
			tags: [],
			created_at: "2024-02-20T14:00:00Z",
			updated_at: "2024-02-20T14:00:00Z",
		},
		{
			id: 3,
			title: "Scheduled Post",
			slug: "scheduled-post",
			published: true,
			pinned: false,
			publish_at: "2999-08-01T10:00:00Z",
			views: 0,
			cover_image: null,
			category: "Tech",
			tags: [],
			created_at: "2026-07-28T10:00:00Z",
			updated_at: "2026-07-28T10:00:00Z",
		},
		{
			id: 4,
			title: "Draft With Future Date",
			slug: "draft-with-future-date",
			// published=false with a future publish_at is STILL a draft (the
			// backend only treats published=true + future as "scheduled").
			published: false,
			pinned: false,
			publish_at: "2999-01-01T00:00:00Z",
			views: 0,
			cover_image: null,
			category: "Dev",
			tags: [],
			created_at: "2026-07-30T10:00:00Z",
			updated_at: "2026-07-30T10:00:00Z",
		},
	],
	pagination: { total: 4, skip: 0, limit: 20 },
};

function makePost(id: number, overrides: Record<string, unknown> = {}) {
	return {
		id,
		title: `Post ${id}`,
		slug: `post-${id}`,
		published: true,
		pinned: false,
		publish_at: null,
		views: 0,
		cover_image: null,
		category: "Tech",
		tags: [],
		created_at: "2024-01-15T10:30:00Z",
		updated_at: "2024-01-15T10:30:00Z",
		...overrides,
	};
}

async function loadPage() {
	const { default: PostsPage } = await import("@/pages/admin/posts/index.vue");
	return PostsPage;
}

describe("Admin Posts Page", () => {
	beforeEach(() => {
		// The list state is a module singleton (round-trip through the editor);
		// a test that searched/filtered/paged must not leak into the next mount.
		resetAdminPostListState();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		window.confirm = originalConfirm;
	});

	describe("Loading state", () => {
		it("renders loading message when posts are pending", async () => {
			mockFetchAdminPosts.mockReturnValue({
				data: ref(null),
				pending: ref(true),
				error: ref(null),
				refresh: vi.fn(),
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("加载中");
		});
	});

	describe("Error state", () => {
		it("renders error message when fetch fails", async () => {
			mockFetchAdminPosts.mockReturnValue({
				data: ref(null),
				pending: ref(false),
				error: ref({ message: "Network error" }),
				refresh: vi.fn(),
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("Network error");
		});
	});

	describe("Empty state", () => {
		it("renders empty state when no posts exist", async () => {
			mockFetchAdminPosts.mockReturnValue({
				data: ref({ items: [], pagination: { total: 0, skip: 0, limit: 20 } }),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("暂无文章");
		});

		it("renders a link to create new post in empty state", async () => {
			mockFetchAdminPosts.mockReturnValue({
				data: ref({ items: [], pagination: { total: 0, skip: 0, limit: 20 } }),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			const createLink = wrapper.find('a[href="/admin/posts/new"]');
			expect(createLink.exists()).toBe(true);
		});
	});

	describe("Populated state", () => {
		beforeEach(() => {
			mockFetchAdminPosts.mockReturnValue({
				data: ref(mockResponse),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the page heading", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("文章管理");
		});

		it("renders the post count", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("4 篇文章");
		});

		it('renders a "new post" link', async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			const createLink = wrapper.find('a[href="/admin/posts/new"]');
			expect(createLink.exists()).toBe(true);
		});

		it("renders post titles in the table", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("First Post");
			expect(wrapper.text()).toContain("Draft Post");
		});

		it("renders published status for published posts", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("已发布");
		});

		it("renders draft status for unpublished posts", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("草稿");
		});

		it("renders scheduled status for scheduled posts", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("定时发布");
		});

		it("renders post dates", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("2024");
		});

		it("shows the publish date for a scheduled post, not its draft creation date (ISS-389)", async () => {
			// Scheduled Post: created 2026-07-28, published + publish_at future
			// (2999-08-01). The Date column must present the go-live date so the
			// operator can see when it goes public — created_at misled by showing
			// the draft date instead.
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("2024"); // published/draft rows keep their dates
			// zh-CN toLocaleDateString("2999/8/1"); the scheduled chip itself shows
			// as "定时发布" together with the future date.
			expect(wrapper.text()).toContain("2999");
			expect(wrapper.text()).toContain("定时发布");
		});

		it("shows the last-edit date for a draft, not its creation date (ISS-389)", async () => {
			// A draft whose updated_at differs from created_at must show updated_at
			// so a fresh draft stands out from a stale one.
			const staleDraft = makePost(9, {
				published: false,
				created_at: "2024-01-15T10:30:00Z",
				updated_at: "2026-09-01T09:00:00Z",
				title: "Stale-Looking Draft",
			});
			mockFetchAdminPosts.mockReturnValue({
				data: ref({
					items: [staleDraft],
					pagination: { total: 1, skip: 0, limit: 20 },
				}),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("Stale-Looking Draft");
			// zh-CN toLocaleDateString of updated_at 2026-09-01 → "2026/9/1".
			expect(wrapper.text()).toContain("2026");
			expect(wrapper.text()).not.toContain("2024/1/15");
		});

		it("renders edit links for each post", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			const editLink = wrapper.find('a[href="/admin/posts/1"]');
			expect(editLink.exists()).toBe(true);
		});

		it("renders a preview link for each post (TASK-187)", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			const previewLink = wrapper.find('a[href="/preview/posts/1"]');
			expect(previewLink.exists()).toBe(true);
		});

		it("renders search input and status filter", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			const searchInput = wrapper.find('input[type="text"]');
			expect(searchInput.element.getAttribute("placeholder")).toContain("搜索");
			expect(wrapper.text()).toContain("全部状态");
			expect(wrapper.text()).toContain("已发布");
			expect(wrapper.text()).toContain("草稿");
			expect(wrapper.text()).toContain("定时发布");
		});

		it("restores the search box and status filter across a remount (editor round-trip, ISS-311)", async () => {
			// The editor returns via a hardcoded /admin/posts URL; the list's
			// search/filter used to live in per-mount setup refs and reset on
			// every return. The module singleton must survive the round-trip.
			mockFetchAdminPosts.mockReturnValue({
				data: ref(mockResponse),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			const PostsPage = await loadPage();
			const w1 = await mountWithSuspense(PostsPage);
			await w1.find('input[type="text"]').setValue("nuxt");
			await w1.find("select").setValue("published");
			await flushPromises();
			w1.unmount();

			const w2 = await mountWithSuspense(PostsPage);
			expect((w2.find('input[type="text"]').element as HTMLInputElement).value).toBe("nuxt");
			expect((w2.find("select").element as HTMLSelectElement).value).toBe("published");
		});

		it("feeds the debounced search term into the reactive listing params", async () => {
			const paramsRefs: Array<Record<string, unknown>> = [];
			mockFetchAdminPosts.mockImplementation((params: Record<string, unknown>) => {
				paramsRefs.push(params);
				return {
					data: ref(mockResponse),
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				};
			});
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);

			const searchInput = wrapper.find('input[type="text"]');
			await searchInput.setValue("test");
			// debounced 300ms — the reactive path, not refresh(), carries the term
			await new Promise((r) => setTimeout(r, 350));

			// The page passes useAdminPosts the live computed (a getter-backed
			// ref); after the debounce its resolved params carry the search term +
			// a reset skip (RIL ISS-275). Without this the snapshot URL never
			// carried the term and searching did nothing.
			const params = paramsRefs[0] as { value: { q?: string; skip?: number } };
			expect(params.value.q).toBe("test");
			expect(params.value.skip).toBe(0);
		});

		it("feeds the selected status into the reactive listing params", async () => {
			const paramsRefs: Array<Record<string, unknown>> = [];
			mockFetchAdminPosts.mockImplementation((params: Record<string, unknown>) => {
				paramsRefs.push(params);
				return {
					data: ref(mockResponse),
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				};
			});
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);

			const statusSelect = wrapper.find("select");
			await statusSelect.setValue("published");
			await flushPromises();

			const params = paramsRefs[0] as { value: { status?: string; skip?: number } };
			expect(params.value.status).toBe("published");
			expect(params.value.skip).toBe(0);
		});

		it("calls deleteAdminPost with confirmation when delete is clicked", async () => {
			window.confirm = vi.fn(() => true);
			mockDeleteAdminPost.mockResolvedValue({});

			const refreshMock = vi.fn();
			mockFetchAdminPosts.mockReturnValue({
				data: ref(mockResponse),
				pending: ref(false),
				error: ref(null),
				refresh: refreshMock,
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);

			const deleteButtons = wrapper.findAll("button");
			const trashButton = deleteButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:trash-2"]');
				return svg.exists();
			});

			expect(trashButton).toBeDefined();
			await trashButton?.trigger("click");
			await flushPromises();

			expect(window.confirm).toHaveBeenCalledWith("确定要删除这篇文章吗？");
			expect(mockDeleteAdminPost).toHaveBeenCalledWith(1);
		});

		it("does NOT call deleteAdminPost when confirmation is cancelled", async () => {
			window.confirm = vi.fn(() => false);

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);

			const deleteButtons = wrapper.findAll("button");
			const trashButton = deleteButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:trash-2"]');
				return svg.exists();
			});

			await trashButton?.trigger("click");
			expect(mockDeleteAdminPost).not.toHaveBeenCalled();
		});

		it("surfaces a delete failure banner (deep-dive)", async () => {
			window.confirm = vi.fn(() => true);
			mockDeleteAdminPost.mockRejectedValue(new Error("boom"));
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);

			const trashButton = wrapper
				.findAll("button")
				.find((b) => b.find('svg[data-icon="lucide:trash-2"]').exists());
			await trashButton?.trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("boom");
		});
	});

	describe("Pagination + delete clamp (deep-dive)", () => {
		beforeEach(() => {
			mockDeleteAdminPost.mockResolvedValue({});
			window.confirm = vi.fn(() => true);
		});

		it("renders pagination bounds and jumps pages within them", async () => {
			// 21 posts → 2 pages. prev disabled on page 1, next disabled on page 2.
			const items = Array.from({ length: 21 }, (_, i) => makePost(i + 1));
			mockFetchAdminPosts.mockReturnValue({
				data: ref({ items, pagination: { total: 21, skip: 0, limit: 20 } }),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("1 / 2");

			const btn = (text: string) => wrapper.findAll("button").find((b) => b.text().includes(text));
			const prev = btn("上一页");
			expect(prev?.attributes("disabled")).toBeDefined();

			await btn("下一页")?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("2 / 2");
			const next = btn("下一页");
			expect(next?.attributes("disabled")).toBeDefined();
		});

		it("clamps back to the last valid page after deleting the last post of the final page (deep-dive)", async () => {
			// 21 posts span 2 pages. On page 2 (0-based 1), deleting one post
			// shrinks the list to 20 → one page, so the page must clamp currentPage
			// back to 0 or the operator strands on an out-of-range skip.
			const items = Array.from({ length: 21 }, (_, i) => makePost(i + 1));
			const dataRef = ref({ items, pagination: { total: 21, skip: 0, limit: 20 } });
			const paramsRefs: Array<Record<string, unknown>> = [];
			mockFetchAdminPosts.mockImplementation((params: Record<string, unknown>) => {
				paramsRefs.push(params);
				return {
					data: dataRef,
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(() => {
						// The refetch reflects the post-delete world: one fewer post,
						// now a single page.
						dataRef.value = {
							items: items.slice(0, 20),
							pagination: { total: 20, skip: 20, limit: 20 },
						};
					}),
				};
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("1 / 2");

			const nextBtn = wrapper.findAll("button").find((b) => b.text().includes("下一页"));
			await nextBtn?.trigger("click"); // page 2 (0-based 1)
			await flushPromises();
			expect(wrapper.text()).toContain("2 / 2");
			expect((paramsRefs[0] as { value: { skip: number } }).value.skip).toBe(20);

			const trashButton = wrapper
				.findAll("button")
				.find((b) => b.find('svg[data-icon="lucide:trash-2"]').exists());
			await trashButton?.trigger("click");
			await flushPromises();

			// refresh() collapsed the list to 20 (single page); the clamp must put
			// the operator back on page 1 — the reactive skip is 0 again.
			expect((paramsRefs[0] as { value: { skip: number } }).value.skip).toBe(0);
		});
	});
});
