/**
 * Post detail page tests
 * Tests rendering states: loading, error, not found, post content rendering,
 * metadata display (category, date, views, tags), and back link navigation.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig, useRoute) and stubs
 * NuxtLink and Icon components (same pattern as other page tests).
 *
 * The post detail page uses `await usePost(...)` in <script setup>, making the
 * setup function async. We wrap the component in a <Suspense> boundary using
 * a template-based wrapper (same pattern as index.spec.ts).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";

// Mock post data matching the Post interface
const mockPost = {
  id: 1,
  title: "Test Article Post",
  slug: "test-article-post",
  excerpt: "This is a test excerpt for the article.",
  content: "# Introduction\n\nThis is the post content.",
  published: true,
  created_at: "2024-01-15T10:30:00Z",
  updated_at: "2024-01-15T10:30:00Z",
  views: 1234,
  likes: 56,
  cover_image: null,
  category: { id: 1, name: "Tech" },
  tags: [
    { id: 1, name: "React" },
    { id: 2, name: "TypeScript" },
  ],
};

async function mountPostPage({
  post = mockPost,
  pending = false,
  error = null,
  slug = "test-article-post",
}: {
  post?: typeof mockPost | null;
  pending?: boolean;
  error?: { message: string } | null;
  slug?: string;
} = {}) {
  vi.stubGlobal("useRuntimeConfig", () => ({
    public: {
      apiUrl: "http://localhost:18888",
    },
  }));

  vi.stubGlobal("useRoute", () => ({
    params: { slug },
    query: {},
  }));

  vi.stubGlobal("navigateTo", vi.fn());

  // Mock useFetch (used by useApi/usePost internally)
  vi.stubGlobal("useFetch", vi.fn(() => ({
    data: ref(post),
    pending: ref(pending),
    error: ref(error),
    refresh: vi.fn(),
  })));

  const { default: PostPage } = await import("@/pages/posts/[slug].vue");

  // Template-based Suspense wrapper (works reliably with @vue/test-utils)
  const SuspenseWrapper: any = {
    components: { PostPage },
    template:
      `<Suspense>` +
      `<template #default><PostPage /></template>` +
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
          template: '<svg class="iconstub" :data-icon="icon"></svg>',
          props: ["icon"],
        },
      },
    },
  });

  await flushPromises();
  return wrapper;
}

describe("Post Detail Page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Loading state", () => {
    it("renders loading skeletons when post is pending", async () => {
      const wrapper = await mountPostPage({ pending: true, post: null });
      const skeletons = wrapper.findAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("Error state", () => {
    it("renders error message when fetch fails", async () => {
      const wrapper = await mountPostPage({
        error: { message: "Network error" },
        post: null,
      });
      expect(wrapper.text()).toContain("加载失败: Network error");
    });
  });

  describe("Post not found", () => {
    it("renders not found message when post is null", async () => {
      const wrapper = await mountPostPage({
        post: null,
        pending: false,
        error: null,
      });
      expect(wrapper.text()).toContain("文章不存在");
    });
  });

  describe("Post content rendering", () => {
    it("renders the post title", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.text()).toContain("Test Article Post");
    });

    it("renders the post excerpt", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.text()).toContain("This is a test excerpt for the article.");
    });

    it("renders the post content via v-html", async () => {
      const wrapper = await mountPostPage();
      const contentDiv = wrapper.find("div.mt-8.text-gray-800");
      expect(contentDiv.exists()).toBe(true);
      expect(contentDiv.text()).toContain("Introduction");
    });

    it("renders a back to home link", async () => {
      const wrapper = await mountPostPage();
      const backLink = wrapper.find('a[href="/"]');
      expect(backLink.exists()).toBe(true);
      expect(backLink.text()).toContain("返回首页");
    });
  });

  describe("Post metadata", () => {
    it("renders the category name", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.text()).toContain("Tech");
    });

    it("renders the view count", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.text()).toContain("1234 次阅读");
    });

    it("renders the formatted date", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.text()).toContain("2024");
      expect(wrapper.text()).toContain("1月");
      expect(wrapper.text()).toContain("15");
    });
  });

  describe("Tags", () => {
    it("renders all tags", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.text()).toContain("React");
      expect(wrapper.text()).toContain("TypeScript");
    });

    it("renders tag elements with correct keys", async () => {
      const wrapper = await mountPostPage();
      const tagSpans = wrapper.findAll("span.inline-flex");
      const tagTexts = tagSpans.map((s) => s.text());
      expect(tagTexts.some((t) => t.includes("React"))).toBe(true);
      expect(tagTexts.some((t) => t.includes("TypeScript"))).toBe(true);
    });
  });

  describe("Article structure", () => {
    it("renders the article element", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.find("article").exists()).toBe(true);
    });

    it("renders a header element", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.find("header").exists()).toBe(true);
    });

    it("renders a footer element when tags exist", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.find("footer").exists()).toBe(true);
    });
  });
});
