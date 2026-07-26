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

// Mock related posts data
const mockRelatedPosts = [
  {
    id: 10,
    title: "Related Post One",
    slug: "related-post-one",
    excerpt: "A related post excerpt.",
    published: true,
    created_at: "2024-03-01T10:00:00Z",
    views: 50,
    cover_image: null,
    category: { id: 1, name: "Tech" },
    tags: [],
  },
  {
    id: 11,
    title: "Related Post Two",
    slug: "related-post-two",
    excerpt: "Another related post excerpt.",
    published: true,
    created_at: "2024-03-05T14:00:00Z",
    views: 30,
    cover_image: null,
    category: { id: 1, name: "Tech" },
    tags: [],
  },
];

async function mountPostPage({
  post = mockPost,
  pending = false,
  error = null,
  slug = "test-article-post",
  relatedPosts = mockRelatedPosts,
}: {
  post?: typeof mockPost | null;
  pending?: boolean;
  error?: { message: string } | null;
  slug?: string;
  relatedPosts?: typeof mockRelatedPosts | null;
} = {}) {
  vi.stubGlobal("useRuntimeConfig", () => ({
    public: {
      apiUrl: "http://localhost:18888",
    },
  }));

  vi.stubGlobal("useHead", vi.fn());

  vi.stubGlobal("useRoute", () => ({
    params: { slug },
    query: {},
  }));

  vi.stubGlobal("navigateTo", vi.fn());

  // Mock useFetch - return related posts for /related endpoint, post data otherwise
  vi.stubGlobal("useFetch", vi.fn((url: string, options?: Record<string, unknown>) => {
    if (typeof url === "string" && url.includes("/related")) {
      return {
        data: ref(relatedPosts),
        pending: ref(false),
        error: ref(null),
        refresh: vi.fn(),
      };
    }
    return {
      data: ref(post),
      pending: ref(pending),
      error: ref(error),
      refresh: vi.fn(),
    };
  }));

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

  describe("View tracking", () => {
    it("calls usePostView (POST to /view endpoint) when post loads", async () => {
      let viewPostCalled = false;
      let viewPostUrl = "";

      vi.stubGlobal("useHead", vi.fn());

      vi.stubGlobal("useRuntimeConfig", () => ({
        public: {
          apiUrl: "http://localhost:18888",
        },
      }));

      vi.stubGlobal("useRoute", () => ({
        params: { slug: "test-article-post" },
        query: {},
      }));

      vi.stubGlobal("navigateTo", vi.fn());

      vi.stubGlobal("useFetch", vi.fn((url: string, options?: Record<string, unknown>) => {
        if (typeof url === "string" && url.includes("/related")) {
          return {
            data: ref(mockRelatedPosts),
            pending: ref(false),
            error: ref(null),
            refresh: vi.fn(),
          };
        }
        // Track POST to /view endpoint (usePostView side effect)
        if (typeof url === "string" && url.includes("/view")) {
          viewPostCalled = true;
          viewPostUrl = url;
          return {
            data: ref(null),
            pending: ref(false),
            error: ref(null),
            refresh: vi.fn(),
          };
        }
        return {
          data: ref(mockPost),
          pending: ref(false),
          error: ref(null),
          refresh: vi.fn(),
        };
      }));

      const { default: PostPage } = await import("@/pages/posts/[slug].vue");

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

      expect(viewPostCalled).toBe(true);
      expect(viewPostUrl).toContain("/view");
      expect(viewPostUrl).toContain("1");
    });

    it("does NOT call usePostView when post fails to load (error state)", async () => {
      let viewPostCalled = false;

      vi.stubGlobal("useHead", vi.fn());

      vi.stubGlobal("useRuntimeConfig", () => ({
        public: {
          apiUrl: "http://localhost:18888",
        },
      }));

      vi.stubGlobal("useRoute", () => ({
        params: { slug: "nonexistent-post" },
        query: {},
      }));

      vi.stubGlobal("navigateTo", vi.fn());

      vi.stubGlobal("useFetch", vi.fn((url: string) => {
        // Track POST to /view endpoint (usePostView side effect)
        if (typeof url === "string" && url.includes("/view")) {
          viewPostCalled = true;
          return {
            data: ref(null),
            pending: ref(false),
            error: ref(null),
            refresh: vi.fn(),
          };
        }
        return {
          data: ref(null),
          pending: ref(false),
          error: ref({ message: "Failed to load post" }),
          refresh: vi.fn(),
        };
      }));

      const { default: PostPage } = await import("@/pages/posts/[slug].vue");

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

      // Post failed to load, so usePostView should NOT have been called
      expect(viewPostCalled).toBe(false);
    });

    it("does NOT call usePostView when post is not found (null post)", async () => {
      let viewPostCalled = false;

      vi.stubGlobal("useHead", vi.fn());

      vi.stubGlobal("useRuntimeConfig", () => ({
        public: {
          apiUrl: "http://localhost:18888",
        },
      }));

      vi.stubGlobal("useRoute", () => ({
        params: { slug: "nonexistent-post" },
        query: {},
      }));

      vi.stubGlobal("navigateTo", vi.fn());

      vi.stubGlobal("useFetch", vi.fn((url: string) => {
        if (typeof url === "string" && url.includes("/view")) {
          viewPostCalled = true;
          return {
            data: ref(null),
            pending: ref(false),
            error: ref(null),
            refresh: vi.fn(),
          };
        }
        // Return related posts for /related endpoint
        if (typeof url === "string" && url.includes("/related")) {
          return {
            data: ref(mockRelatedPosts),
            pending: ref(false),
            error: ref(null),
            refresh: vi.fn(),
          };
        }
        return {
          data: ref(null),
          pending: ref(false),
          error: ref(null),
          refresh: vi.fn(),
        };
      }));

      const { default: PostPage } = await import("@/pages/posts/[slug].vue");

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

      // Post is null (not found), so usePostView should NOT have been called
      expect(viewPostCalled).toBe(false);
    });
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

  describe("Cover image", () => {
    it("renders the cover image when present", async () => {
      const wrapper = await mountPostPage({
        post: { ...mockPost, cover_image: "https://example.com/cover.jpg" } as any,
      });
      const img = wrapper.find("img[alt='Test Article Post']");
      expect(img.exists()).toBe(true);
      expect(img.attributes("src")).toBe("https://example.com/cover.jpg");
    });

    it("does NOT render a cover image when absent", async () => {
      const wrapper = await mountPostPage();
      const img = wrapper.find("img");
      expect(img.exists()).toBe(false);
    });
  });

  describe("Like button", () => {
    it("renders the like button", async () => {
      const wrapper = await mountPostPage();
      const button = wrapper.find('button[type="button"]');
      expect(button.exists()).toBe(true);
      expect(button.text()).toContain("喜欢");
    });

    it("renders the like count when present", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.text()).toContain("56 次喜欢");
    });

    it("does NOT render like count when zero", async () => {
      const wrapper = await mountPostPage({
        post: { ...mockPost, likes: 0 } as any,
      });
      expect(wrapper.text()).not.toContain("次喜欢");
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

  describe("Related Posts", () => {
    it("renders the related posts section header", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.text()).toContain("相关文章");
    });

    it("renders related post titles", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.text()).toContain("Related Post One");
      expect(wrapper.text()).toContain("Related Post Two");
    });

    it("renders related post excerpts", async () => {
      const wrapper = await mountPostPage();
      expect(wrapper.text()).toContain("A related post excerpt.");
    });

    it("renders links to related posts", async () => {
      const wrapper = await mountPostPage();
      const links = wrapper.findAll('a[href^="/posts/related"]');
      expect(links.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Related posts data flow", () => {
    it("fetches related posts with the correct post ID (not 0)", async () => {
      let relatedPostsUrl = "";

      vi.stubGlobal("useRuntimeConfig", () => ({
        public: {
          apiUrl: "http://localhost:18888",
        },
      }));

      vi.stubGlobal("useRoute", () => ({
        params: { slug: "test-article-post" },
        query: {},
      }));

      vi.stubGlobal("navigateTo", vi.fn());

      vi.stubGlobal("useFetch", vi.fn((url: string) => {
        if (typeof url === "string" && url.includes("/related")) {
          relatedPostsUrl = url;
          return {
            data: ref(mockRelatedPosts),
            pending: ref(false),
            error: ref(null),
            refresh: vi.fn(),
          };
        }
        return {
          data: ref(mockPost),
          pending: ref(false),
          error: ref(null),
          refresh: vi.fn(),
        };
      }));

      const { default: PostPage } = await import("@/pages/posts/[slug].vue");

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

      // Verify related posts were fetched with post ID 1 (from mockPost.id)
      expect(relatedPostsUrl).toContain("/related");
      expect(relatedPostsUrl).toContain("1");
      // Should NOT have been called with ID 0 (the fallback for undefined post ID)
      expect(relatedPostsUrl).not.toMatch(/\/0\/related/);
    });

    it("does NOT call useRelatedPosts when post is not found (null post)", async () => {
      let relatedPostsUrl = "";

      vi.stubGlobal("useHead", vi.fn());

      vi.stubGlobal("useRuntimeConfig", () => ({
        public: {
          apiUrl: "http://localhost:18888",
        },
      }));

      vi.stubGlobal("useRoute", () => ({
        params: { slug: "nonexistent-post" },
        query: {},
      }));

      vi.stubGlobal("navigateTo", vi.fn());

      vi.stubGlobal("useFetch", vi.fn((url: string) => {
        if (typeof url === "string" && url.includes("/related")) {
          relatedPostsUrl = url;
          return {
            data: ref([]),
            pending: ref(false),
            error: ref(null),
            refresh: vi.fn(),
          };
        }
        // Return null post (not found)
        return {
          data: ref(null),
          pending: ref(false),
          error: ref(null),
          refresh: vi.fn(),
        };
      }));

      const { default: PostPage } = await import("@/pages/posts/[slug].vue");

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

      // When post is null, useRelatedPosts should NOT be called
      expect(relatedPostsUrl).toBe("");
    });
  });
});
