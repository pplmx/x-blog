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
const { mockFetchComments } = vi.hoisted(() => ({
	mockFetchComments: vi.fn(),
}));
vi.mock("~/composables/useApi", () => ({
	fetchComments: mockFetchComments,
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
}: {
	comments?: typeof mockComments | null;
	pending?: boolean;
	postId?: number;
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

		it("renders each comment in a list item", async () => {
			const { wrapper } = await mountCommentList();
			const items = wrapper.findAll("li");
			expect(items.length).toBeGreaterThanOrEqual(2);
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
});
