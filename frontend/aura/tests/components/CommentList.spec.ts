/**
 * CommentList component tests
 * Tests rendering states: loading, empty, populated comments,
 * date formatting, pagination, and the loadPage navigation callback.
 *
 * Mocks the fetchComments composable module to return
 * controlled mock data, then verifies the component renders
 * correctly in each state.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

// Mock the composable module before importing the component.
// The component imports from '~/composables/useApi' — in the vitest
// config we alias ~/composables to the root composables/ directory
// (matching Nuxt's resolution), so vi.mock can intercept the specifier.
// vi.hoisted ensures the mock function is created before the factory runs
// (vi.mock is hoisted to the top of the file).
const { mockFetchComments, mockCreateComment } = vi.hoisted(() => ({
	mockFetchComments: vi.fn(),
	mockCreateComment: vi.fn(),
}));
vi.mock("~/composables/useApi", () => ({
	fetchComments: mockFetchComments,
	createComment: mockCreateComment,
}));

import CommentList from "../../components/CommentList.vue";

// Mock comment data
const mockComments = {
	items: [
		{
			id: 1,
			post_id: 1,
			parent_id: null,
			nickname: "Alice",
			email: "alice@test.com",
			content: "This is a great post!",
			is_approved: true,
			ip_address: "127.0.0.1",
			created_at: "2024-01-15T10:30:00Z",
		},
		{
			id: 2,
			post_id: 1,
			parent_id: null,
			nickname: "Bob",
			email: "bob@test.com",
			content: "Thanks for sharing.",
			is_approved: true,
			ip_address: "127.0.0.1",
			created_at: "2024-02-20T14:00:00Z",
		},
	],
	total: 2,
	total_pages: 3,
	page: 1,
	limit: 20,
};

const mockEmptyComments = {
	items: [],
	total: 0,
	total_pages: 0,
	page: 1,
	limit: 20,
};

async function mountCommentList({
	comments = mockComments,
	pending = false,
	postId = 1,
	attachToBody = false,
}: {
	comments?: typeof mockComments | null;
	pending?: boolean;
	postId?: number;
	attachToBody?: boolean;
} = {}) {
	const mockData = ref(comments ? { ...comments } : null);
	const mockResult = {
		data: mockData,
		pending: ref(pending),
		error: ref(null),
		refresh: vi.fn(),
	};

	mockFetchComments.mockReturnValue(mockResult);

	// The component uses `await fetchComments(...)` in <script setup>, making
	// setup async. We wrap it in a <Suspense> boundary, same pattern as
	// the page tests (see slug.spec.ts, search.spec.ts, etc.).
	const SuspenseWrapper: any = {
		components: { CommentList },
		template:
			"<Suspense>" +
			`<template #default><CommentList :post-id="${postId}" /></template>` +
			"<template #fallback>Loading...</template>" +
			"</Suspense>",
	};

	const wrapper = mount(SuspenseWrapper, {
		attachTo: attachToBody ? document.body : undefined,
		global: {
			stubs: {
				Icon: {
					template: '<svg class="iconstub" :data-icon="icon"></svg>',
					props: ["icon"],
				},
			},
		},
	});

	await flushPromises();
	return { wrapper, mockData, mockResult };
}

describe("CommentList", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Section header", () => {
		it("renders the comment title with total count", async () => {
			const { wrapper } = await mountCommentList();
			expect(wrapper.text()).toContain("评论");
			expect(wrapper.text()).toContain("2");
		});

		it("renders section title even with zero comments", async () => {
			const { wrapper } = await mountCommentList({
				comments: mockEmptyComments,
			});
			expect(wrapper.text()).toContain("评论");
			expect(wrapper.text()).toContain("0");
		});
	});

	describe("Loading state", () => {
		it("renders loading skeletons when pending", async () => {
			const { wrapper } = await mountCommentList({
				pending: true,
				comments: null,
			});
			const skeletons = wrapper.findAll(".animate-pulse");
			expect(skeletons.length).toBeGreaterThan(0);
		});
	});

	describe("Empty state", () => {
		it("renders empty message when no comments", async () => {
			const { wrapper } = await mountCommentList({
				comments: mockEmptyComments,
			});
			expect(wrapper.text()).toContain("还没有评论");
		});

		it("prompts user to write first comment", async () => {
			const { wrapper } = await mountCommentList({
				comments: mockEmptyComments,
			});
			expect(wrapper.text()).toContain("发第一个评论");
		});
	});

	describe("Comment rendering", () => {
		it("renders all comment items", async () => {
			const { wrapper } = await mountCommentList();
			expect(wrapper.text()).toContain("Alice");
			expect(wrapper.text()).toContain("Bob");
		});

		it("renders comment content", async () => {
			const { wrapper } = await mountCommentList();
			expect(wrapper.text()).toContain("This is a great post!");
			expect(wrapper.text()).toContain("Thanks for sharing.");
		});

		it("renders formatted dates", async () => {
			const { wrapper } = await mountCommentList();
			expect(wrapper.text()).toContain("2024");
		});

		it("renders a #comment-<id> anchor on every comment (DEC-072)", async () => {
			const { wrapper } = await mountCommentList();
			expect(wrapper.find('li[id="comment-1"]').exists()).toBe(true);
			expect(wrapper.find('li[id="comment-2"]').exists()).toBe(true);
		});

		it("scrolls to the #comment-<id> anchor on mount when the hash matches", async () => {
			const original = Element.prototype.scrollIntoView;
			const scrollIntoView = vi.fn();
			Element.prototype.scrollIntoView =
				scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
			window.history.replaceState(null, "", "/posts/x#comment-2");
			expect(window.location.hash).toBe("#comment-2");
			try {
				const { wrapper } = await mountCommentList({ attachToBody: true });
				expect(document.getElementById("comment-2")).toBeTruthy();
				expect(scrollIntoView).toHaveBeenCalledTimes(1);
			} finally {
				Element.prototype.scrollIntoView = original;
				window.history.replaceState(null, "", "/");
			}
		});

		it("does not scroll when the hash is not a comment deep-link", async () => {
			const original = Element.prototype.scrollIntoView;
			const scrollIntoView = vi.fn();
			Element.prototype.scrollIntoView =
				scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
			window.history.replaceState(null, "", "/posts/x#some-other-anchor");
			try {
				const { wrapper } = await mountCommentList({ attachToBody: true });
				expect(scrollIntoView).not.toHaveBeenCalled();
			} finally {
				Element.prototype.scrollIntoView = original;
				window.history.replaceState(null, "", "/");
			}
		});

		it("renders each comment in a list item", async () => {
			const { wrapper } = await mountCommentList();
			const items = wrapper.findAll("li");
			expect(items.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe("Markdown rendering (DEC-088, TASK-156)", () => {
		it("renders comment markdown as HTML (code block, bold, line breaks)", async () => {
			const mdComments = {
				items: [
					{
						id: 1,
						post_id: 1,
						parent_id: null,
						nickname: "U",
						email: "u@x.com",
						content: "Line one\nLine two\n\n**bold** and `code`\n\n```ts\nconst x = 1;\n```",
						is_approved: true,
						ip_address: "127.0.0.1",
						created_at: "2024-01-15T10:30:00Z",
					},
				],
				total: 1,
				total_pages: 1,
				page: 1,
				limit: 20,
			};
			const { wrapper } = await mountCommentList({ comments: mdComments });
			expect(wrapper.find(".comment-body pre code").exists()).toBe(true);
			expect(wrapper.find(".comment-body strong").exists()).toBe(true);
			expect(wrapper.find(".comment-body br").exists()).toBe(true); // breaks: true keeps newlines
		});

		it("strips script tags and event handlers from comment HTML (XSS-safe)", async () => {
			const xssComments = {
				items: [
					{
						id: 2,
						post_id: 1,
						parent_id: null,
						nickname: "X",
						email: "x@x.com",
						content:
							'hello <script>window.__xss=1</script> <img src=x onerror="alert(1)"> [click](javascript:alert(1))',
						is_approved: true,
						ip_address: "127.0.0.1",
						created_at: "2024-01-15T10:30:00Z",
					},
				],
				total: 1,
				total_pages: 1,
				page: 1,
				limit: 20,
			};
			const { wrapper } = await mountCommentList({ comments: xssComments });
			expect(wrapper.find(".comment-body script").exists()).toBe(false);
			expect((wrapper.element as HTMLElement).querySelector("script")).toBeNull();
			expect(wrapper.find("[onerror]").exists()).toBe(false);
			// javascript: links are neutralized by the sanitizer.
			expect((wrapper.element as HTMLElement).querySelector('a[href^="javascript:"]')).toBeNull();
		});
	});

	describe("Syntax highlighting (DEC-090, TASK-157)", () => {
		it("tokenizes fenced code blocks in comment bodies with highlight.js", async () => {
			const codeComments = {
				items: [
					{
						id: 3,
						post_id: 1,
						parent_id: null,
						nickname: "Snippy",
						email: "s@x.com",
						content: "```ts\nconst x = 1;\n```",
						is_approved: true,
						ip_address: "127.0.0.1",
						created_at: "2024-01-15T10:30:00Z",
					},
				],
				total: 1,
				total_pages: 1,
				page: 1,
				limit: 20,
			};
			const { wrapper } = await mountCommentList({ comments: codeComments });
			// Highlight loads the lazy highlight.js bundle asynchronously after
			// mount + DOMPurify upgrade, so poll for the token spans.
			await vi.waitFor(() => {
				const code = wrapper.find(".comment-body pre code.language-ts");
				expect(code.exists()).toBe(true);
				// `const` is a keyword in the typescript grammar — its token
				// span only exists once highlighting has run.
				expect(code.find(".hljs-keyword").exists()).toBe(true);
			});
			// The highlighted HTML still carries the escaped source (no live tags).
			expect(wrapper.find(".comment-body pre code.language-ts").text()).toContain("const x = 1;");
		});

		it("keeps unknown-language blocks as plain escaped text (no highlight error)", async () => {
			const plainComments = {
				items: [
					{
						id: 4,
						post_id: 1,
						parent_id: null,
						nickname: "Plain",
						email: "p@x.com",
						content: "```weirdlang\nsudo rm -rf /\n```",
						is_approved: true,
						ip_address: "127.0.0.1",
						created_at: "2024-01-15T10:30:00Z",
					},
				],
				total: 1,
				total_pages: 1,
				page: 1,
				limit: 20,
			};
			const { wrapper } = await mountCommentList({ comments: plainComments });
			await vi.waitFor(() => {
				expect(wrapper.find(".comment-body pre code").exists()).toBe(true);
			});
			// highlightCode falls back to escaped plain text; the raw source is
			// still visible (no highlight.js failure, no raw HTML).
			expect(wrapper.find(".comment-body pre code").text()).toContain("sudo rm -rf /");
			expect(wrapper.find(".comment-body pre code .hljs-keyword").exists()).toBe(false);
		});
	});

	describe("Pagination", () => {
		it("renders pagination when total_pages > 1", async () => {
			const { wrapper } = await mountCommentList();
			const nav = wrapper.find("nav");
			expect(nav.exists()).toBe(true);
		});

		it("does NOT render pagination when only 1 page", async () => {
			const { wrapper } = await mountCommentList({
				comments: { ...mockComments, total_pages: 1 },
			});
			const nav = wrapper.find("nav");
			expect(nav.exists()).toBe(false);
		});

		it("renders page buttons", async () => {
			const { wrapper } = await mountCommentList();
			const buttons = wrapper.findAll("nav button");
			expect(buttons.length).toBe(3);
		});

		it("highlights current page button", async () => {
			const { wrapper } = await mountCommentList();
			const buttons = wrapper.findAll("nav button");
			expect(buttons[0].classes()).toContain("bg-blue-600");
		});

		it("calls fetchComments when clicking a page button", async () => {
			const { wrapper } = await mountCommentList();
			const buttons = wrapper.findAll("nav button");
			await buttons[1].trigger("click");
			await flushPromises();

			expect(mockFetchComments.mock.calls.length).toBeGreaterThan(1);
			expect(mockFetchComments).toHaveBeenLastCalledWith(1, 2, 20);
		});
	});

	describe("No pagination when total_pages is 0", () => {
		it("does not render nav when total_pages is 0", async () => {
			const { wrapper } = await mountCommentList({
				comments: mockEmptyComments,
			});
			const nav = wrapper.find("nav");
			expect(nav.exists()).toBe(false);
		});
	});

	describe("Threaded replies", () => {
		const threadedComments = {
			items: [
				{
					id: 1,
					post_id: 1,
					parent_id: null,
					nickname: "Alice",
					email: "alice@test.com",
					content: "Top-level comment",
					is_approved: true,
					ip_address: "127.0.0.1",
					created_at: "2024-01-15T10:30:00Z",
				},
				{
					id: 2,
					post_id: 1,
					parent_id: 1,
					nickname: "Bob",
					email: "bob@test.com",
					content: "A reply to Alice",
					is_approved: true,
					ip_address: "127.0.0.1",
					created_at: "2024-01-16T10:30:00Z",
				},
				{
					id: 3,
					post_id: 1,
					parent_id: null,
					nickname: "Carol",
					email: "carol@test.com",
					content: "Another top-level",
					is_approved: true,
					ip_address: "127.0.0.1",
					created_at: "2024-01-17T10:30:00Z",
				},
			],
			total: 3,
			total_pages: 1,
			page: 1,
			limit: 20,
		};

		it("shows a Reply button on each top-level comment", async () => {
			const { wrapper } = await mountCommentList({ comments: threadedComments });
			expect(wrapper.text()).toContain("回复");
		});

		it("renders replies nested under their parent (not as top-level)", async () => {
			const { wrapper } = await mountCommentList({ comments: threadedComments });
			expect(wrapper.text()).toContain("A reply to Alice");
			// Both top-level comments are anchors of list items; the reply is
			// nested inside Alice's li.
			const aliceLi = wrapper.findAll("li").find((li) => li.text().includes("Top-level comment"));
			expect(aliceLi).toBeDefined();
			expect(aliceLi?.text()).toContain("A reply to Alice");
		});

		it("does not render a top-level li for a reply", async () => {
			const { wrapper } = await mountCommentList({ comments: threadedComments });
			// Reply content should only appear once (nested), not as its own item
			const replyOccurrences = wrapper.text().split("A reply to Alice").length - 1;
			expect(replyOccurrences).toBe(1);
		});

		it("opens an inline reply form when Reply is clicked", async () => {
			const { wrapper } = await mountCommentList({ comments: threadedComments });
			const replyBtn = wrapper.findAll("button").find((b) => b.text() === "回复");
			expect(replyBtn).toBeDefined();
			if (!replyBtn) throw new Error("expected a reply button");
			await replyBtn.trigger("click");
			await flushPromises();
			// CommentForm is mocked at the module level in a sibling spec, but
			// here the real CommentForm renders; at minimum a textarea appears.
			expect(wrapper.find("textarea").exists()).toBe(true);
			expect(wrapper.text()).toContain("正在回复");
		});
	});

	describe("Deep replies (reply to a reply, RIL ISS-037)", () => {
		const deepComments = {
			items: [
				{
					id: 10,
					post_id: 1,
					parent_id: null,
					nickname: "Root",
					email: "root@test.com",
					content: "Root comment",
					is_approved: true,
					ip_address: "127.0.0.1",
					created_at: "2024-01-10T10:00:00Z",
				},
				{
					id: 11,
					post_id: 1,
					parent_id: 10,
					nickname: "Level1",
					email: "l1@test.com",
					content: "Reply to root",
					is_approved: true,
					ip_address: "127.0.0.1",
					created_at: "2024-01-11T10:00:00Z",
				},
				{
					id: 12,
					post_id: 1,
					parent_id: 11,
					nickname: "Level2",
					email: "l2@test.com",
					content: "Reply to the reply (deep)",
					is_approved: true,
					ip_address: "127.0.0.1",
					created_at: "2024-01-12T10:00:00Z",
				},
			],
			total: 3,
			total_pages: 1,
			page: 1,
			limit: 20,
		};

		it("renders a reply-to-a-reply nested under its top-level ancestor", async () => {
			const { wrapper } = await mountCommentList({ comments: deepComments });
			expect(wrapper.text()).toContain("Root comment");
			expect(wrapper.text()).toContain("Reply to root");
			// The deep reply must appear (previously dropped entirely)
			expect(wrapper.text()).toContain("Reply to the reply (deep)");
			const rootLi = wrapper.findAll("li").find((li) => li.text().includes("Root comment"));
			expect(rootLi).toBeDefined();
			// Deep reply lives inside the root's list item
			expect(rootLi?.text()).toContain("Reply to the reply (deep)");
		});

		it("does not render the deep reply as its own top-level item", async () => {
			const { wrapper } = await mountCommentList({ comments: deepComments });
			// The deep reply should not be a top-level <li> sibling of root
			const deepOccurrences = wrapper.text().split("Reply to the reply (deep)").length - 1;
			expect(deepOccurrences).toBe(1);
		});

		it("shows a Reply button on nested replies and opens a reply form (RIL TASK-080)", async () => {
			const { wrapper } = await mountCommentList({ comments: deepComments });
			// Two nested replies (Level1 id=11, Level2 id=12) each get a Reply button.
			const replyButtons = wrapper.findAll("button").filter((b) => b.text() === "回复");
			// 1 top-level (Root) + 2 nested = 3 reply buttons.
			expect(replyButtons.length).toBe(3);

			// Click the deepest reply's (Level2) Reply button — it's the last
			// one, as nested replies render after the top-level comment.
			await replyButtons[2].trigger("click");
			await flushPromises();

			// The inline reply form appears (CommentForm renders a textarea).
			expect(wrapper.find("textarea").exists()).toBe(true);
			// And it targets the Level2 comment as its parent via the real
			// CommentForm: the "正在回复 {name}" context is shown for Level2.
			expect(wrapper.text()).toContain("Level2");
		});
	});

	describe("verified reader badge (DEC-062, TASK-136)", () => {
		it("renders a verified badge for reader-attributed comments", async () => {
			const readerComments = {
				items: [
					{
						id: 30,
						post_id: 1,
						parent_id: null,
						nickname: "Riki",
						content: "Signed-in comment",
						is_approved: true,
						created_at: "2024-06-01T10:00:00Z",
						reader: { id: 1, display_name: "Riki" },
					},
					{
						id: 31,
						post_id: 1,
						parent_id: null,
						nickname: "Guest",
						content: "Anonymous comment",
						is_approved: true,
						created_at: "2024-06-02T10:00:00Z",
						reader: null,
					},
				],
				total: 2,
				total_pages: 1,
				page: 1,
				limit: 20,
			} as const;
			const { wrapper } = await mountCommentList({ comments: readerComments });
			// The reader-attributed comment carries the verified badge icon.
			expect(wrapper.findAll('[data-icon="lucide:badge-check"]').length).toBe(1);
			// The anonymous comment has none.
			expect(wrapper.text()).toContain("Riki");
			expect(wrapper.text()).toContain("Guest");
		});
	});
});
