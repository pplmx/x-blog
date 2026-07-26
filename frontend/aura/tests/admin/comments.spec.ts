/**
 * Admin Comments Page Tests
 *
 * Tests the admin comments page: loading state, error state,
 * empty state, populated state with comment rendering, approval
 * status badges, date/IP display, approve/unapprove actions,
 * and delete functionality.
 *
 * Mocks the fetchAdminComments, deleteAdminComment, and
 * approveAdminComment composables. Uses a <Suspense> wrapper
 * since the page uses `await fetchAdminComments()` in <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const { mockFetchAdminComments, mockDeleteAdminComment, mockApproveAdminComment } = vi.hoisted(
	() => ({
		mockFetchAdminComments: vi.fn(),
		mockDeleteAdminComment: vi.fn(),
		mockApproveAdminComment: vi.fn(),
	}),
);

vi.mock("~/composables/useApi", () => ({
	fetchAdminComments: mockFetchAdminComments,
	deleteAdminComment: mockDeleteAdminComment,
	approveAdminComment: mockApproveAdminComment,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());

const originalConfirm = window.confirm;

const mockComments = [
	{
		id: 1,
		post_id: 10,
		post_title: "Test Post Title",
		nickname: "Alice",
		email: "alice@test.com",
		content: "This is a great post!",
		ip_address: "127.0.0.1",
		is_approved: true,
		created_at: "2024-01-15T10:30:00Z",
	},
	{
		id: 2,
		post_id: 20,
		post_title: "Another Post",
		nickname: "Bob",
		email: "bob@test.com",
		content: "Thanks for sharing this.",
		ip_address: "192.168.1.1",
		is_approved: false,
		created_at: "2024-02-20T14:00:00Z",
	},
];

async function loadPage() {
	const { default: CommentsPage } = await import("@/pages/admin/comments.vue");
	return CommentsPage;
}

describe("Admin Comments Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		window.confirm = originalConfirm;
	});

	describe("Loading state", () => {
		it("renders loading spinner when comments are pending", async () => {
			mockFetchAdminComments.mockReturnValue({
				data: ref(null),
				pending: ref(true),
				error: ref(null),
				refresh: vi.fn(),
			});

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("加载中");
		});
	});

	describe("Error state", () => {
		it("renders error message when fetch fails", async () => {
			mockFetchAdminComments.mockReturnValue({
				data: ref(null),
				pending: ref(false),
				error: ref({ message: "Server error" }),
				refresh: vi.fn(),
			});

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("Server error");
		});
	});

	describe("Empty state", () => {
		it("renders empty state when no comments exist", async () => {
			mockFetchAdminComments.mockReturnValue({
				data: ref([]),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("暂无评论");
		});
	});

	describe("Populated state", () => {
		beforeEach(() => {
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockComments),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the page heading", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("评论管理");
		});

		it("renders the comment count", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("2 条评论");
		});

		it("renders commenter nicknames", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("Alice");
			expect(wrapper.text()).toContain("Bob");
		});

		it("renders commenter emails", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("alice@test.com");
			expect(wrapper.text()).toContain("bob@test.com");
		});

		it("renders comment content", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("This is a great post!");
			expect(wrapper.text()).toContain("Thanks for sharing this.");
		});

		it("renders approved status for approved comments", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("已审核");
		});

		it("renders pending status for unapproved comments", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("待审核");
		});

		it("renders post titles", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("Test Post Title");
			expect(wrapper.text()).toContain("Another Post");
		});

		it("renders IP addresses", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("127.0.0.1");
			expect(wrapper.text()).toContain("192.168.1.1");
		});

		it("renders formatted dates", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("2024");
		});

		it('renders a "review through" button for unapproved comments', async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			// Bob's comment is unapproved, should have a "审核通过" button
			expect(wrapper.text()).toContain("审核通过");
		});

		it('renders a "cancel review" button for approved comments', async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			// Alice's comment is approved, should have a "取消审核" button
			expect(wrapper.text()).toContain("取消审核");
		});

		it("renders delete buttons for all comments", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			const deleteButtons = wrapper.findAll("button");
			const trashButtons = deleteButtons.filter((b) => b.text().trim() === "删除");
			expect(trashButtons.length).toBeGreaterThanOrEqual(2);
		});

		it("calls approveAdminComment with approved=true when approving", async () => {
			mockApproveAdminComment.mockResolvedValue({});

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Find the "审核通过" button (for unapproved comment)
			const approveButtons = wrapper.findAll("button");
			const approveButton = approveButtons.find((b) => b.text().includes("审核通过"));
			expect(approveButton).toBeDefined();

			await approveButton?.trigger("click");
			await flushPromises();

			expect(mockApproveAdminComment).toHaveBeenCalledWith(2, true);
		});

		it("calls approveAdminComment with approved=false when unapproving", async () => {
			mockApproveAdminComment.mockResolvedValue({});

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Find the "取消审核" button (for approved comment)
			const unapproveButtons = wrapper.findAll("button");
			const unapproveButton = unapproveButtons.find((b) => b.text().includes("取消审核"));
			expect(unapproveButton).toBeDefined();

			await unapproveButton?.trigger("click");
			await flushPromises();

			expect(mockApproveAdminComment).toHaveBeenCalledWith(1, false);
		});

		it("calls deleteAdminComment with confirmation when delete is clicked", async () => {
			window.confirm = vi.fn(() => true);
			mockDeleteAdminComment.mockResolvedValue({});

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			const deleteButtons = wrapper.findAll("button");
			const trashButton = deleteButtons.find((b) => b.text().trim() === "删除");

			await trashButton?.trigger("click");
			await flushPromises();

			expect(window.confirm).toHaveBeenCalledWith("确定要删除这条评论吗？");
			expect(mockDeleteAdminComment).toHaveBeenCalled();
		});

		it("does NOT call deleteAdminComment when confirmation is cancelled", async () => {
			window.confirm = vi.fn(() => false);

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			const deleteButtons = wrapper.findAll("button");
			const trashButton = deleteButtons.find((b) => b.text().trim() === "删除");

			await trashButton?.trigger("click");
			expect(mockDeleteAdminComment).not.toHaveBeenCalled();
		});
	});
});
