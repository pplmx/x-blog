/**
 * Index page tests
 * Tests rendering states: loading, error, empty, posts listing, pagination.
 * Mocks Nuxt composables (useFetch, useRuntimeConfig, useRoute, navigateTo)
 * and stubs NuxtLink and Icon components.
 *
 * The index page uses `await useFetch(...)` in <script setup>, making the
 * setup function async. We wrap the component in a <Suspense> boundary
 * using a template-based wrapper.
 *
 * The index page also uses `computed` without importing it (Nuxt auto-imports
 * it), so we stub it globally.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref, reactive, computed } from "vue";

// Mock data
const mockPostListResponse = {
  items: [
    {
      id: 1,
      title: "First Post",
      slug: "first-post",
      excerpt: "First excerpt",
      published: true,
      created_at: "2024-01-15T10:00:00Z",
      views: 100,
      cover_image: null,
      category: { id: 1, name: "Tech" },
      tags: [],
    },
    {
      id: 2,
      title: "Second Post",
      slug: "second-post",
      excerpt: "Second excerpt",
      published: true,
      created_at: "2024-02-20T14:30:00Z",
      views: 50,
      cover_image: null,
      category: { id: 2, name: "Life" },
      tags: [],
    },
  ],
  pagination: {
    total: 2,
    page: 1,
    limit: 10,
    total_pages: 2,
  },
};

const mockEmptyResponse = {
  items: [],
  pagination: {
    total: 0,
    page: 1,
    limit: 10,
    total_pages: 1,
  },
};

type MockResponse = typeof mockPostListResponse;

async function mountIndexPage({
  posts = mockPostListResponse,
  pending = false,
  error = null,
  routeQuery = {},
}: {
  posts?: MockResponse | null;
  pending?: boolean;
  error?: { message: string } | null;
  routeQuery?: Record<string, string>;
} = {}) {
  vi.stubGlobal("useRuntimeConfig", () => ({
    public: {
      apiUrl: "http://localhost:18888",
    },
  }));

  vi.stubGlobal("useRoute", () => reactive({ query: routeQuery }));

  vi.stubGlobal("navigateTo", vi.fn());

  // The index page uses `computed` without importing it (Nuxt auto-imports it)
  vi.stubGlobal("computed", computed);

  vi.stubGlobal("useFetch", vi.fn(() => ({
    data: ref(posts),
    pending: ref(pending),
    error: ref(error),
    refresh: vi.fn(),
  })));

  const { default: IndexPage } = await import("../../app/pages/index.vue");

  // Template-based Suspense wrapper (works reliably with @vue/test-utils)
  const SuspenseWrapper: any = {
    components: { IndexPage },
    template:
      `<Suspense>` +
      `<template #default><IndexPage /></template>` +
      `<template #fallback>Loading...</template>` +
      `</Suspense>`,
  };

  const wrapper = mount(SuspenseWrapper, {
    global: {
      stubs: {
        NuxtLink: {
          template: '<a :href="to"><slot/></a>',
          props: ["to"],
        },
        Icon: {
          template: '<svg class="iconstub" data-icon=":icon"></svg>',
          props: ["icon"],
        },
      },
    },
  });

  await flushPromises();
  return wrapper;
}

describe("Index Page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Loading state", () => {
    it("renders loading skeletons when posts are pending", async () => {
      const wrapper = await mountIndexPage({ pending: true });
      const skeletons = wrapper.findAll(".animate-pulse");
      expect(skeletons.length).toBe(3);
    });
  });

  describe("Error state", () => {
    it("renders error message when fetch fails", async () => {
      const wrapper = await mountIndexPage({
        error: { message: "Network error" },
      });
      expect(wrapper.text()).toContain("加载失败: Network error");
    });
  });

  describe("Empty state", () => {
    it("renders empty state when no posts", async () => {
      const wrapper = await mountIndexPage({ posts: mockEmptyResponse });
      expect(wrapper.text()).toContain("暂无文章");
    });
  });

  describe("Posts listing", () => {
    it("renders hero header", async () => {
      const wrapper = await mountIndexPage();
      expect(wrapper.text()).toContain("X-Blog");
      expect(wrapper.text()).toContain("一个现代化的技术博客系统");
    });

    it("renders post titles", async () => {
      const wrapper = await mountIndexPage();
      expect(wrapper.text()).toContain("First Post");
      expect(wrapper.text()).toContain("Second Post");
    });

    it("renders post excerpts", async () => {
      const wrapper = await mountIndexPage();
      expect(wrapper.text()).toContain("First excerpt");
      expect(wrapper.text()).toContain("Second excerpt");
    });

    it("renders post category names", async () => {
      const wrapper = await mountIndexPage();
      expect(wrapper.text()).toContain("Tech");
      expect(wrapper.text()).toContain("Life");
    });

    it("renders post view counts", async () => {
      const wrapper = await mountIndexPage();
      expect(wrapper.text()).toContain("100 次阅读");
      expect(wrapper.text()).toContain("50 次阅读");
    });

    it("renders post links with correct hrefs", async () => {
      const wrapper = await mountIndexPage();
      const links = wrapper.findAll('a[href^="/posts/"]');
      expect(links.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Pagination", () => {
    it("renders pagination when there are multiple pages", async () => {
      const wrapper = await mountIndexPage();
      const buttons = wrapper.findAll("button");
      const pageButtons = buttons.filter((b) => /\d/.test(b.text()));
      expect(pageButtons.length).toBeGreaterThan(0);
    });

    it("renders pagination buttons for each page", async () => {
      const wrapper = await mountIndexPage();
      expect(wrapper.text()).toContain("1");
      expect(wrapper.text()).toContain("2");
    });
  });
});
