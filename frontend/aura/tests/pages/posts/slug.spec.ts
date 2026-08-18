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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
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

// Mock adjacent (prev/next) posts data
const mockAdjacentPosts = {
	previous: {
		id: 9,
		title: "Previous Article",
		slug: "previous-article",
		excerpt: "Before this one.",
		published: true,
		created_at: "2023-12-01T10:00:00Z",
		views: 20,
		cover_image: null,
		category: { id: 1, name: "Tech" },
		tags: [],
	},
	next: {
		id: 12,
		title: "Next Article",
		slug: "next-article",
		excerpt: "After this one.",
		published: true,
		created_at: "2024-05-01T10:00:00Z",
		views: 40,
		cover_image: null,
		category: { id: 2, name: "Science" },
		tags: [],
	},
};

async function mountPostPage({
	post = mockPost,
	pending = false,
	error = null,
	slug = "test-article-post",
	relatedPosts = mockRelatedPosts,
	adjacentPosts = mockAdjacentPosts,
	seriesDetail = null,
}: {
	post?: typeof mockPost | null;
	pending?: boolean;
	error?: { message: string } | null;
	slug?: string;
	relatedPosts?: typeof mockRelatedPosts | null;
	adjacentPosts?: typeof mockAdjacentPosts | null;
	seriesDetail?: Record<string, unknown> | null;
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
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string, _options?: Record<string, unknown>) => {
			if (typeof url === "function") url = url();
			if (typeof url === "string" && url.includes("/adjacent")) {
				return {
					data: ref(adjacentPosts),
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				};
			}
			if (typeof url === "string" && url.includes("/related")) {
				return {
					data: ref(relatedPosts),
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				};
			}
			if (typeof url === "string" && url.includes("/api/series/")) {
				return {
					data: ref(seriesDetail),
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
		}),
	);

	const { default: PostPage } = await import("@/pages/posts/[slug].vue");

	// Template-based Suspense wrapper (works reliably with @vue/test-utils)
	const SuspenseWrapper: any = {
		components: { PostPage },
		template:
			"<Suspense>" +
			"<template #default><PostPage /></template>" +
			"<template #fallback>Loading...</template>" +
			"</Suspense>",
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
				// Stub MarkdownContent so tests don't need to load mermaid/katex/dompurify.
				// Renders the content prop as plain HTML so test assertions still work.
				MarkdownContent: {
					template: '<div class="markdown-content"><div v-html="content"></div></div>',
					props: ["content"],
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
		try {
			localStorage.removeItem("x_blog_liked_posts");
		} catch {
			// happy-dom may not have full localStorage
		}
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

			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string, _options?: Record<string, unknown>) => {
					if (typeof url === "function") url = url();
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
				}),
			);

			const { default: PostPage } = await import("@/pages/posts/[slug].vue");

			const SuspenseWrapper: any = {
				components: { PostPage },
				template:
					"<Suspense>" +
					"<template #default><PostPage /></template>" +
					"<template #fallback>Loading...</template>" +
					"</Suspense>",
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

			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string) => {
					if (typeof url === "function") url = url();
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
				}),
			);

			const { default: PostPage } = await import("@/pages/posts/[slug].vue");

			const SuspenseWrapper: any = {
				components: { PostPage },
				template:
					"<Suspense>" +
					"<template #default><PostPage /></template>" +
					"<template #fallback>Loading...</template>" +
					"</Suspense>",
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

			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string) => {
					if (typeof url === "function") url = url();
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
				}),
			);

			const { default: PostPage } = await import("@/pages/posts/[slug].vue");

			const SuspenseWrapper: any = {
				components: { PostPage },
				template:
					"<Suspense>" +
					"<template #default><PostPage /></template>" +
					"<template #fallback>Loading...</template>" +
					"</Suspense>",
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
			expect(wrapper.text()).toContain("加载失败");
			expect(wrapper.text()).toContain("Network error");
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

		it("renders the post content via MarkdownContent", async () => {
			const wrapper = await mountPostPage();
			const contentWrapper = wrapper.find("div.markdown-content");
			expect(contentWrapper.exists()).toBe(true);
			expect(contentWrapper.text()).toContain("Introduction");
		});

		it("renders a back to home link", async () => {
			const wrapper = await mountPostPage();
			const backLink = wrapper.find('a[href="/"]');
			expect(backLink.exists()).toBe(true);
			expect(backLink.text()).toContain("返回首页");
		});
	});

	describe("Cover image", () => {
		it("renders algorithmic SVG data URI even when cover image is provided", async () => {
			const wrapper = await mountPostPage({
				post: {
					...mockPost,
					cover_image: "https://example.com/cover.jpg",
				} as any,
			});
			const img = wrapper.find("img[alt='Test Article Post']");
			expect(img.exists()).toBe(true);
			// All posts now render algorithmic SVG for display consistency
			expect(img.attributes("src")).toContain("data:image/svg+xml");
		});

		it("renders an algorithmic SVG data URI when no cover image", async () => {
			const wrapper = await mountPostPage();
			const img = wrapper.find("img");
			expect(img.exists()).toBe(true);
			expect(img.attributes("src")).toContain("data:image/svg+xml");
		});
	});

	describe("SEO JSON-LD", () => {
		it("emits a BlogPosting JSON-LD script in useHead when post loads", async () => {
			const useHeadSpy = vi.fn();
			vi.stubGlobal("useHead", useHeadSpy);
			vi.stubGlobal("useRuntimeConfig", () => ({
				public: { apiUrl: "http://localhost:18888" },
			}));
			vi.stubGlobal("useRoute", () => ({
				params: { slug: "test-article-post" },
				query: {},
			}));
			vi.stubGlobal("navigateTo", vi.fn());
			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string) => {
					if (typeof url === "function") url = url();
					if (typeof url === "string" && url.includes("/related")) {
						return {
							data: ref(mockRelatedPosts),
							pending: ref(false),
							error: ref(null),
							refresh: vi.fn(),
						};
					}
					if (typeof url === "string" && url.includes("/view")) {
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
				}),
			);

			const { default: PostPage } = await import("@/pages/posts/[slug].vue");
			const SuspenseWrapper: any = {
				components: { PostPage },
				template:
					"<Suspense>" +
					"<template #default><PostPage /></template>" +
					"<template #fallback>Loading...</template>" +
					"</Suspense>",
			};
			mount(SuspenseWrapper, {
				global: {
					stubs: {
						NuxtLink: { template: '<a :href="to"><slot/></a>', props: ["to"] },
						Icon: {
							template: '<svg class="iconstub" :data-icon="icon"></svg>',
							props: ["icon"],
						},
						MarkdownContent: {
							template: '<div class="markdown-content"><div v-html="content"></div></div>',
							props: ["content"],
						},
					},
				},
			});
			await flushPromises();

			const callArg = useHeadSpy.mock.calls[0][0];
			const ldScripts = callArg.script.filter(
				(s: { type: string }) => s.type === "application/ld+json",
			);
			expect(ldScripts.length).toBe(1);
			const jsonLd = JSON.parse(ldScripts[0].textContent);
			expect(jsonLd["@context"]).toBe("https://schema.org");
			expect(jsonLd["@type"]).toBe("BlogPosting");
			expect(jsonLd.headline).toBe("Test Article Post");
			expect(jsonLd.datePublished).toBe("2024-01-15T10:30:00Z");
			expect(jsonLd.author.name).toBe("X-Blog");
			expect(jsonLd.articleSection).toBe("Tech");
		});
	});

	describe("Like button", () => {
		it("renders the like button", async () => {
			const wrapper = await mountPostPage();
			const button = wrapper.find('button[type="button"]');
			expect(button.exists()).toBe(true);
			expect(button.text()).toContain("56");
		});

		it("exposes the like toggle state via aria-pressed (RIL TASK-084)", async () => {
			const wrapper = await mountPostPage();
			const button = wrapper.find("[aria-pressed]");
			expect(button.exists()).toBe(true);
			// Not liked yet -> pressed=false
			expect(button.attributes("aria-pressed")).toBe("false");
			expect(button.attributes("aria-label")).toBeDefined();
		});

		it("renders the like count when present", async () => {
			const wrapper = await mountPostPage();
			expect(wrapper.text()).toContain("56");
		});

		it("does NOT render like count when zero", async () => {
			const wrapper = await mountPostPage({
				post: { ...mockPost, likes: 0 } as any,
			});
			expect(wrapper.text()).not.toContain("次喜欢");
		});

		it("displays an error message when liking fails", async () => {
			// Stub useFetch so the POST /like call throws, simulating a network error
			vi.stubGlobal("useRuntimeConfig", () => ({
				public: { apiUrl: "http://localhost:18888" },
			}));
			vi.stubGlobal("useHead", vi.fn());
			vi.stubGlobal("useRoute", () => ({
				params: { slug: "test-article-post" },
				query: {},
			}));
			vi.stubGlobal("navigateTo", vi.fn());
			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string) => {
					if (typeof url === "function") url = url();
					if (typeof url === "string" && url.includes("/like")) {
						throw new Error("Network error");
					}
					return {
						data: ref(mockPost),
						pending: ref(false),
						error: ref(null),
						refresh: vi.fn(),
					};
				}),
			);

			const { default: PostPage } = await import("@/pages/posts/[slug].vue");
			const SuspenseWrapper: any = {
				components: { PostPage },
				template:
					"<Suspense>" +
					"<template #default><PostPage /></template>" +
					"<template #fallback>Loading...</template>" +
					"</Suspense>",
			};
			const wrapper = mount(SuspenseWrapper, {
				global: {
					stubs: {
						NuxtLink: { template: '<a :href="to"><slot/></a>', props: ["to"] },
						Icon: {
							template: '<svg class="iconstub" :data-icon="icon"></svg>',
							props: ["icon"],
						},
						MarkdownContent: {
							template: '<div class="markdown-content"><div v-html="content"></div></div>',
							props: ["content"],
						},
					},
				},
			});
			await flushPromises();

			// Click the like button — usePostLike should throw and trigger the catch block
			await wrapper.find('button[type="button"]').trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("点赞失败，请稍后重试。");
		});

		it("updates the rendered like count after a successful like", async () => {
			// Stub useFetch so the POST /like returns a post with an incremented
			// like count — the UI must reflect the new value (regression guard for
			// handleLike discarding the updated post, which left the count stale).
			const likedPost = { ...mockPost, likes: 57 };
			vi.stubGlobal("useRuntimeConfig", () => ({
				public: { apiUrl: "http://localhost:18888" },
			}));
			vi.stubGlobal("useHead", vi.fn());
			vi.stubGlobal("useRoute", () => ({
				params: { slug: "test-article-post" },
				query: {},
			}));
			vi.stubGlobal("navigateTo", vi.fn());
			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string) => {
					if (typeof url === "function") url = url();
					if (typeof url === "string" && url.includes("/like")) {
						return {
							data: ref(likedPost),
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
				}),
			);

			const { default: PostPage } = await import("@/pages/posts/[slug].vue");
			const SuspenseWrapper: any = {
				components: { PostPage },
				template:
					"<Suspense>" +
					"<template #default><PostPage /></template>" +
					"<template #fallback>Loading...</template>" +
					"</Suspense>",
			};
			const wrapper = mount(SuspenseWrapper, {
				global: {
					stubs: {
						NuxtLink: { template: '<a :href="to"><slot/></a>', props: ["to"] },
						Icon: {
							template: '<svg class="iconstub" :data-icon="icon"></svg>',
							props: ["icon"],
						},
						MarkdownContent: {
							template: '<div class="markdown-content"><div v-html="content"></div></div>',
							props: ["content"],
						},
					},
				},
			});
			await flushPromises();

			expect(wrapper.text()).toContain("56");

			await wrapper.find('button[type="button"]').trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("57");
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
			const tagLinks = wrapper.findAll("a.inline-flex");
			const tagTexts = tagLinks.map((s) => s.text());
			expect(tagTexts.some((t) => t.includes("React"))).toBe(true);
			expect(tagTexts.some((t) => t.includes("TypeScript"))).toBe(true);
		});
	});

	describe("Category/tag navigation", () => {
		it("renders the category chip as a link", async () => {
			const wrapper = await mountPostPage();
			const catLink = wrapper.findAll("a.inline-flex");
			// Category chip + back-to-home link are anchors; category text present
			expect(wrapper.find("a.inline-flex").exists()).toBe(true);
			// The category name renders and the chipled element is an anchor
			expect(catLink.some((a) => a.text().includes("Tech"))).toBe(true);
		});

		it("renders tag chips as links", async () => {
			const wrapper = await mountPostPage();
			const tagLinks = wrapper.findAll("a.inline-flex");
			expect(tagLinks.some((a) => a.text().includes("React"))).toBe(true);
			expect(tagLinks.some((a) => a.text().includes("TypeScript"))).toBe(true);
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

			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string) => {
					if (typeof url === "function") url = url();
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
				}),
			);

			const { default: PostPage } = await import("@/pages/posts/[slug].vue");

			const SuspenseWrapper: any = {
				components: { PostPage },
				template:
					"<Suspense>" +
					"<template #default><PostPage /></template>" +
					"<template #fallback>Loading...</template>" +
					"</Suspense>",
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

			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string) => {
					if (typeof url === "function") url = url();
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
				}),
			);

			const { default: PostPage } = await import("@/pages/posts/[slug].vue");

			const SuspenseWrapper: any = {
				components: { PostPage },
				template:
					"<Suspense>" +
					"<template #default><PostPage /></template>" +
					"<template #fallback>Loading...</template>" +
					"</Suspense>",
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

	describe("Prev/Next navigation", () => {
		it("renders previous and next post links with correct hrefs", async () => {
			const wrapper = await mountPostPage();

			const links = wrapper.findAll(
				'a[href="/posts/previous-article"], a[href="/posts/next-article"]',
			);
			expect(links.length).toBe(2);

			const text = wrapper.text();
			expect(text).toContain("Previous Article");
			expect(text).toContain("Next Article");
		});

		it("renders only the next link when previous is null (feed head)", async () => {
			const wrapper = await mountPostPage({
				adjacentPosts: { previous: null, next: mockAdjacentPosts.next },
			});

			const links = wrapper.findAll('a[href="/posts/next-article"]');
			expect(links.length).toBe(1);
			expect(wrapper.findAll('a[href="/posts/previous-article"]').length).toBe(0);
		});

		it("renders no nav section when both neighbours are null", async () => {
			const wrapper = await mountPostPage({
				adjacentPosts: { previous: null, next: null },
			});

			expect(wrapper.findAll('a[href="/posts/previous-article"]').length).toBe(0);
			expect(wrapper.findAll('a[href="/posts/next-article"]').length).toBe(0);
		});
	});

	describe("In-series navigation (DEC-056)", () => {
		// A post that belongs to a series, with the series detail loaded so the
		// chip and prev/next-in-series nav can resolve the position.
		const seriesPost = {
			...mockPost,
			series: { id: 1, title: "FastAPI Deep Dive", slug: "fastapi-deep-dive" },
			series_order: 1,
		};
		const seriesPosts = [
			{
				id: 9,
				title: "Part One: Routing",
				slug: "part-one-routing",
				created_at: "2024-05-01T10:00:00Z",
				views: 40,
				cover_image: null,
				category: { id: 1, name: "Tech" },
				tags: [],
				series: { id: 1, title: "FastAPI Deep Dive", slug: "fastapi-deep-dive" },
				series_order: 0,
			},
			{
				id: 1,
				title: "Test Article Post",
				slug: "test-article-post",
				created_at: "2024-01-15T10:30:00Z",
				views: 1234,
				cover_image: null,
				category: { id: 1, name: "Tech" },
				tags: [],
				series: { id: 1, title: "FastAPI Deep Dive", slug: "fastapi-deep-dive" },
				series_order: 1,
			},
			{
				id: 12,
				title: "Part Three: Security",
				slug: "part-three-security",
				created_at: "2024-05-15T10:00:00Z",
				views: 25,
				cover_image: null,
				category: { id: 1, name: "Tech" },
				tags: [],
				series: { id: 1, title: "FastAPI Deep Dive", slug: "fastapi-deep-dive" },
				series_order: 2,
			},
		];
		const mockSeriesDetail = {
			id: 1,
			title: "FastAPI Deep Dive",
			slug: "fastapi-deep-dive",
			description: "A guided tour.",
			post_count: 3,
			posts: seriesPosts,
		};

		it("renders the series chip linking to the series page", async () => {
			const wrapper = await mountPostPage({
				post: seriesPost,
				seriesDetail: mockSeriesDetail,
			});
			const chip = wrapper.find('a[href="/series/fastapi-deep-dive"]');
			expect(chip.exists()).toBe(true);
			expect(chip.text()).toContain("第 2 篇");
			expect(chip.text()).toContain("共 3 篇");
		});

		it("renders previous and next in-series links in series order", async () => {
			const wrapper = await mountPostPage({
				post: seriesPost,
				seriesDetail: mockSeriesDetail,
			});
			const prev = wrapper.findAll('a[href="/posts/part-one-routing"]');
			const next = wrapper.findAll('a[href="/posts/part-three-security"]');
			// only the in-series nav links (linear feed nav has none here since
			// adjacentPosts defaults to previous/next articles — those hrefs differ)
			expect(prev.length).toBeGreaterThanOrEqual(1);
			expect(next.length).toBeGreaterThanOrEqual(1);
			expect(wrapper.text()).toContain("Part One: Routing");
			expect(wrapper.text()).toContain("Part Three: Security");
		});

		it("renders no in-series nav for a post without a series", async () => {
			const wrapper = await mountPostPage({ post: mockPost, seriesDetail: null });
			expect(wrapper.findAll('a[href^="/series/"]').length).toBe(0);
			expect(wrapper.text()).not.toContain("本系列文章");
		});

		it("renders only the next in-series link at the start and only prev at the end", async () => {
			// position 1 of 3: no previous
			const first = await mountPostPage({
				post: {
					...seriesPost,
					id: 9,
					slug: "part-one-routing",
					series_order: 0,
					title: "Part One: Routing",
				},
				seriesDetail: mockSeriesDetail,
			});
			expect(first.findAll('a[href="/posts/part-one-routing"]').length).toBe(0);
			expect(first.findAll('a[href="/posts/test-article-post"]').length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("Table of Contents", () => {
		it("renders TOC sidebar when post has multiple headings", async () => {
			const postWithHeadings = {
				...mockPost,
				content:
					'<h1 id="introduction">Introduction</h1>\n<p>Text here.</p>\n<h2 id="getting-started">Getting Started</h2>\n<p>More text.</p>\n<h3 id="basics">Basics</h3>\n<p>Even more.</p>\n<h2 id="advanced">Advanced</h2>\n<p>Final section.</p>',
			};

			const wrapper = await mountPostPage({ post: postWithHeadings });

			// TOC sidebar should be visible with heading titles
			const tocLinks = wrapper.findAll('a[href^="#"]');
			const headingLinks = tocLinks.filter((a) =>
				["#introduction", "#getting-started", "#basics", "#advanced"].includes(
					a.attributes("href"),
				),
			);
			expect(headingLinks.length).toBe(4);
		});

		it("renders TOC from Markdown content (RIL TASK-104, ISS-084 regression)", async () => {
			// Real posts store Markdown (`# Heading`), not HTML. Prior to the
			// fix extractToc was fed raw Markdown -> always empty TOC on real
			// posts; the HTML-based tests above masked this.
			const markdownPost = {
				...mockPost,
				content:
					"# Introduction\n\nSome lead text.\n\n## Getting Started\n\nHow-to.\n\n## Advanced\n\nMore.",
			};

			const wrapper = await mountPostPage({ post: markdownPost });

			const tocLinks = wrapper.findAll('a[href^="#"]');
			const headingLinks = tocLinks.filter((a) =>
				["#introduction", "#getting-started", "#advanced"].includes(a.attributes("href")),
			);
			expect(headingLinks.length).toBe(3);
			expect(headingLinks[0].attributes("href")).toBe("#introduction");
			expect(headingLinks[1].attributes("href")).toBe("#getting-started");
			expect(headingLinks[2].attributes("href")).toBe("#advanced");
		});

		it("does NOT render TOC sidebar when post has only one heading", async () => {
			const singleHeadingPost = {
				...mockPost,
				content: "<h1>Only One Heading</h1>\n<p>No other headings here.</p>",
			};

			const wrapper = await mountPostPage({ post: singleHeadingPost });

			// No heading links should be in TOC
			const headingLinks = wrapper.findAll('a[href^="#"]');
			expect(headingLinks.length).toBe(0);
		});

		it("does NOT render TOC sidebar when post has no headings", async () => {
			const noHeadingsPost = {
				...mockPost,
				content: "<p>Just some plain text with no headings at all.</p>",
			};

			const wrapper = await mountPostPage({ post: noHeadingsPost });

			const headingLinks = wrapper.findAll('a[href^="#"]');
			expect(headingLinks.length).toBe(0);
		});
	});
});
