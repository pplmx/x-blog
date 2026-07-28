/**
 * Admin Comments Page Tests
 *
 * Tests the admin comments page: loading state, error state,
 * empty state, populated state with comment rendering, approval
 * status badges, date/IP display, approve/unapprove actions,
 * and delete functionality.
 *
 * Mocks the fetchAdminComments, deleteAdminComment,
 * approveAdminComment, and batchApproveAdminComment composable.
 * Uses a <Suspense> wrapper since the page uses
 * `await fetchAdminComments()` in <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const { mockFetchAdminComments, mockDeleteAdminComment, mockApproveAdminComment, mockBatchApproveAdminComment } = vi.hoisted(
	() => ({
		mockFetchAdminComments: vi.fn(),
		mockDeleteAdminComment: vi.fn(),
		mockApproveAdminComment: vi.fn(),
		mockBatchApproveAdminComment: vi.fn(),
	}),
);

vi.mock("~/composables/useApi", () => ({
	fetchAdminComments: mockFetchAdminComments,
	deleteAdminComment: mockDeleteAdminComment,
	approveAdminComment: mockApproveAdminComment,
	batchApproveAdminComment: mockBatchApproveAdminComment,
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

		it('renders approve button for unapproved comments', async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			// Bob's comment is unapproved, should have a "通过" button
			expect(wrapper.text()).toContain("通过");
		});

		it('renders "撤销" button for approved comments', async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			// Alice's comment is approved, should have a "撤销" button
			expect(wrapper.text()).toContain("撤销");
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

			const approveButtons = wrapper.findAll("button");
			const approveButton = approveButtons.find((b) => b.text().trim() === "通过");
			expect(approveButton).toBeDefined();

			await approveButton?.trigger("click");
			await flushPromises();

			expect(mockApproveAdminComment).toHaveBeenCalledWith(2, true);
		});

		it("calls approveAdminComment with approved=false when unapproving", async () => {
			mockApproveAdminComment.mockResolvedValue({});

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			const unapproveButtons = wrapper.findAll("button");
			const unapproveButton = unapproveButtons.find((b) => b.text().trim() === "撤销");
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

	describe("Batch select and approve", () => {
		beforeEach(() => {
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockComments),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockBatchApproveAdminComment.mockResolvedValue({});
		});

		it("renders select-all checkbox when pending comments exist", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			const selectAllCheckbox = wrapper.find('input[type="checkbox"][class*="rounded"]');
			expect(selectAllCheckbox.exists()).toBe(true);
		});

		it("toggles individual comment selection via checkbox", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Bob's comment (id=2) is unapproved, has a checkbox
			const checkboxes = wrapper.findAll('input[type="checkbox"]');
			// First checkbox is the select-all, second is individual comment checkbox
			const individualCheckbox = checkboxes[checkboxes.length - 2]; // Bob's checkbox (unapproved)
			expect(individualCheckbox.exists()).toBe(true);

			await individualCheckbox.setChecked();
			expect((individualCheckbox.element as HTMLInputElement).checked).toBe(true);
		});

		it("calls batchApproveAdminComment with approved=true when batch approve clicked", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Select Bob's checkbox (unapproved comment)
			const checkboxes = wrapper.findAll('input[type="checkbox"]');
			const individualCheckbox = checkboxes[checkboxes.length - 2];
			await individualCheckbox.setChecked();

			// Click batch approve button
			const batchApproveButton = wrapper
				.findAll("button")
				.find((b) => b.text().trim().includes("批量通过"));
			expect(batchApproveButton).toBeDefined();

			await batchApproveButton?.trigger("click");
			await flushPromises();

			expect(mockBatchApproveAdminComment).toHaveBeenCalledWith([2], true);
		});

		it("calls batchApproveAdminComment with approved=false when batch reject clicked", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Select Bob's checkbox (unapproved comment)
			const checkboxes = wrapper.findAll('input[type="checkbox"]');
			const individualCheckbox = checkboxes[checkboxes.length - 2];
			await individualCheckbox.setChecked();

			// Click batch reject button
			const batchRejectButton = wrapper
				.findAll("button")
				.find((b) => b.text().trim().includes("批量拒绝"));
			expect(batchRejectButton).toBeDefined();

			await batchRejectButton?.trigger("click");
			await flushPromises();

			expect(mockBatchApproveAdminComment).toHaveBeenCalledWith([2], false);
		});

		it("does NOT call batchApproveAdminComment when no comments are selected", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Click batch approve button without selecting anything
			const batchApproveButton = wrapper
				.findAll("button")
				.find((b) => b.text().trim().includes("批量通过"));
			expect(batchApproveButton).toBeDefined();

			await batchApproveButton?.trigger("click");
			await flushPromises();

			expect(mockBatchApproveAdminComment).not.toHaveBeenCalled();
		});

		it("selects all pending comments via toggleSelectAll then approves", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Select all via the select-all checkbox (Bob is unapproved, Alice is approved)
			const checkboxes = wrapper.findAll('input[type="checkbox"]');
			const selectAllCheckbox = checkboxes[0];

			await selectAllCheckbox.setChecked();
			expect((selectAllCheckbox.element as HTMLInputElement).checked).toBe(true);

			// Click batch approve
			const batchApproveButton = wrapper
				.findAll("button")
				.find((b) => b.text().trim().includes("批量通过"));
			await batchApproveButton?.trigger("click");
			await flushPromises();

			expect(mockBatchApproveAdminComment).toHaveBeenCalledWith([2], true);
		});

		it("disables batch buttons when no comments are selected", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Without selecting, batch buttons should be disabled
			const batchApproveButton = wrapper
				.findAll("button")
				.find((b) => b.text().trim().includes("批量通过"));
			expect(batchApproveButton?.attributes("disabled")).toBeDefined();
		});

		it("sets isProcessing during batch approve", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Select Bob's checkbox
			const checkboxes = wrapper.findAll('input[type="checkbox"]');
			const individualCheckbox = checkboxes[checkboxes.length - 2];
			await individualCheckbox.setChecked();

			const batchApproveButton = wrapper
				.findAll("button")
				.find((b) => b.text().trim().includes("批量通过"));
			await batchApproveButton?.trigger("click");

			// Button should be disabled during processing
			expect(batchApproveButton?.attributes("disabled")).toBeDefined();

			await flushPromises();
		});
	});
});
