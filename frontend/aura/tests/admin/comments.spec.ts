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
import { mountWithSuspense } from "./helpers.ts";

const {
	mockFetchAdminComments,
	mockDeleteAdminComment,
	mockApproveAdminComment,
	mockBatchApproveAdminComments,
	mockBatchDeleteAdminComments,
	mockDismissAdminCommentFlags,
	mockReplyAdminComment,
} = vi.hoisted(() => ({
	mockFetchAdminComments: vi.fn(),
	mockDeleteAdminComment: vi.fn(),
	mockApproveAdminComment: vi.fn(),
	mockBatchApproveAdminComments: vi.fn(),
	mockBatchDeleteAdminComments: vi.fn(),
	mockDismissAdminCommentFlags: vi.fn(),
	mockReplyAdminComment: vi.fn(),
}));

vi.mock("~~/api/admin/comments", () => ({
	getAdminComments: mockFetchAdminComments,
	deleteAdminComment: mockDeleteAdminComment,
	approveAdminComment: mockApproveAdminComment,
	batchApproveAdminComments: mockBatchApproveAdminComments,
	batchDeleteAdminComments: mockBatchDeleteAdminComments,
	dismissAdminCommentFlags: mockDismissAdminCommentFlags,
	replyAdminComment: mockReplyAdminComment,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

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

/** Envelope returned by the paginated admin comments endpoint. */
const mockCommentList = {
	items: mockComments,
	pagination: { total: 2, page: 1, limit: 100, total_pages: 1 },
};

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
			// The page loads via onMounted -> loadComments; a never-resolving
			// fetch keeps the internal `loading` flag true (the page's own ref,
			// not the mock's pending ref).
			mockFetchAdminComments.mockReturnValue(new Promise(() => {}));

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("加载中");
		});
	});

	describe("Error state", () => {
		it("renders error message when fetch fails", async () => {
			mockFetchAdminComments.mockRejectedValue(new Error("Server error"));

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("Server error");
		});
	});

	describe("Empty state", () => {
		it("renders empty state when no comments exist", async () => {
			mockFetchAdminComments.mockResolvedValue({
				items: [],
				pagination: { total: 0, page: 1, limit: 20, total_pages: 0 },
			});

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			expect(wrapper.text()).toContain("暂无评论");
		});
	});

	describe("Populated state", () => {
		beforeEach(() => {
			mockFetchAdminComments.mockResolvedValue(mockCommentList);
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

		it("renders approve button for unapproved comments", async () => {
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
			// The queue reload is silent — the success feedback (ISS-311) must render.
			expect(wrapper.text()).toContain("评论已通过审核");
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
			// Reject/revoke feedback (ISS-311).
			expect(wrapper.text()).toContain("已撤销该评论的审核通过");
		});

		it("replies to an approved comment as the author, then reloads (DEC-192)", async () => {
			mockReplyAdminComment.mockResolvedValue({});
			const fetchSpy = vi.mocked(mockFetchAdminComments);

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			const before = fetchSpy.mock.calls.length;

			// Only the approved comment (id 1) exposes the reply action.
			const replyButtons = wrapper.findAll("button");
			const replyButton = replyButtons.find((b) => b.text().trim() === "回复");
			expect(replyButton).toBeDefined();
			await replyButton?.trigger("click");

			const textarea = wrapper.find("textarea");
			expect(textarea.exists()).toBe(true);
			await textarea.setValue("感谢反馈，已修复。");
			await wrapper
				.findAll("button")
				.find((b) => b.text().trim() === "发送回复")
				?.trigger("click");
			await flushPromises();

			expect(mockReplyAdminComment).toHaveBeenCalledWith(1, "感谢反馈，已修复。");
			expect(fetchSpy.mock.calls.length).toBeGreaterThan(before); // queue reloads
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
			mockFetchAdminComments.mockResolvedValue(mockCommentList);
			mockBatchApproveAdminComments.mockResolvedValue({});
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

			// Select Bob's checkbox (unapproved comment — the last one now, since
			// every visible comment gets a checkbox).
			const checkboxes = wrapper.findAll('input[type="checkbox"]');
			const individualCheckbox = checkboxes[checkboxes.length - 1];
			await individualCheckbox.setChecked();

			// Click batch approve button
			const batchApproveButton = wrapper
				.findAll("button")
				.find((b) => b.text().trim().includes("批量通过"));
			expect(batchApproveButton).toBeDefined();

			await batchApproveButton?.trigger("click");
			await flushPromises();

			expect(mockBatchApproveAdminComments).toHaveBeenCalledWith([2], true);
			// Batch success feedback (ISS-311).
			expect(wrapper.text()).toContain("已通过 1 条评论");
		});

		it("calls batchApproveAdminComment with approved=false when batch reject clicked", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Select Bob's checkbox (last one)
			const checkboxes = wrapper.findAll('input[type="checkbox"]');
			const individualCheckbox = checkboxes[checkboxes.length - 1];
			await individualCheckbox.setChecked();

			// Click batch reject button
			const batchRejectButton = wrapper
				.findAll("button")
				.find((b) => b.text().trim().includes("批量拒绝"));
			expect(batchRejectButton).toBeDefined();

			await batchRejectButton?.trigger("click");
			await flushPromises();

			expect(mockBatchApproveAdminComments).toHaveBeenCalledWith([2], false);
			// Batch reject feedback (ISS-311).
			expect(wrapper.text()).toContain("已拒绝 1 条评论");
		});

		it("does NOT call batchApproveAdminComment when no comments are selected", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Without a selection the batch buttons are not rendered at all, so
			// nothing can be called.
			const batchApproveButton = wrapper
				.findAll("button")
				.find((b) => b.text().trim().includes("批量通过"));
			expect(batchApproveButton).toBeUndefined();
			await flushPromises();
			expect(mockBatchApproveAdminComments).not.toHaveBeenCalled();
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

			expect(mockBatchApproveAdminComments).toHaveBeenCalledWith([1, 2], true);
		});

		it("renders batch buttons only once a comment is selected", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Nothing selected -> no batch buttons; after selecting Bob they appear.
			expect(
				wrapper.findAll("button").find((b) => b.text().trim().includes("批量通过")),
			).toBeUndefined();

			const checkboxes = wrapper.findAll('input[type="checkbox"]');
			await checkboxes[checkboxes.length - 1].setChecked();
			await flushPromises();
			const after = wrapper.findAll("button").find((b) => b.text().trim().includes("批量通过"));
			expect(after).toBeDefined();
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

		it("bulk-deletes selected comments after confirmation (DEC-110)", async () => {
			mockFetchAdminComments.mockResolvedValue(mockCommentList);
			mockBatchDeleteAdminComments.mockResolvedValue({ deleted: 1 });
			window.confirm = vi.fn(() => true);

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			const checkboxes = wrapper.findAll('input[type="checkbox"]');
			// Select Bob's comment (last checkbox, since every comment is selectable).
			await checkboxes[checkboxes.length - 1].setChecked();
			await flushPromises();

			const batchDeleteButton = wrapper
				.findAll("button")
				.find((b) => b.text().trim().includes("删除所选"));
			expect(batchDeleteButton).toBeDefined();
			await batchDeleteButton?.trigger("click");
			await flushPromises();

			expect(window.confirm).toHaveBeenCalledWith(
				expect.stringContaining("确定删除选中的 1 条评论"),
			);
			expect(mockBatchDeleteAdminComments).toHaveBeenCalledWith([2]);
		});
	});

	describe("Pagination", () => {
		it("shows page navigation and loads the next page", async () => {
			const page1 = {
				items: mockComments,
				pagination: { total: 40, page: 1, limit: 20, total_pages: 2 },
			};
			const page2 = {
				items: [
					{
						id: 3,
						post_id: 30,
						post_title: "Page Two Post",
						nickname: "Carol",
						email: "carol@test.com",
						content: "Comment from page two",
						ip_address: "127.0.0.4",
						is_approved: false,
						created_at: "2024-03-12T10:00:00Z",
					},
				],
				pagination: { total: 40, page: 2, limit: 20, total_pages: 2 },
			};
			mockFetchAdminComments.mockResolvedValueOnce(page1).mockResolvedValue(page2);

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			expect(wrapper.text()).toContain("第 1 / 2 页");

			const nextButton = wrapper.findAll("button").find((b) => b.text().trim() === "下一页");
			expect(nextButton).toBeDefined();
			await nextButton?.trigger("click");
			await flushPromises();

			expect(mockFetchAdminComments).toHaveBeenLastCalledWith(
				{ isApproved: undefined, q: undefined, dateFrom: undefined, dateTo: undefined },
				2,
				20,
			);
			expect(wrapper.text()).toContain("Comment from page two");
			expect(wrapper.text()).toContain("第 2 / 2 页");
		});

		it("hides page navigation when there is a single page", async () => {
			mockFetchAdminComments.mockResolvedValue(mockCommentList);
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			const nextButton = wrapper.findAll("button").find((b) => b.text().trim() === "下一页");
			expect(nextButton).toBeUndefined();
			expect(wrapper.text()).not.toContain("第 1 /");
		});

		it("does not leave page 1 when the previous button is disabled", async () => {
			const twoPages = {
				items: mockComments,
				pagination: { total: 40, page: 1, limit: 20, total_pages: 2 },
			};
			mockFetchAdminComments.mockResolvedValue(twoPages);
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			const prevButton = wrapper.findAll("button").find((b) => b.text().trim() === "上一页");
			expect(prevButton?.attributes("disabled")).toBeDefined();
			await prevButton?.trigger("click");
			await flushPromises();
			// still page 1 — no additional fetch happened
			expect(mockFetchAdminComments).toHaveBeenCalledTimes(1);
		});

		it("applies the search filter via Enter and reloads", async () => {
			mockFetchAdminComments.mockResolvedValue(mockCommentList);
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			const searchInput = wrapper.find('input[placeholder*="昵称"]');
			expect(searchInput.exists()).toBe(true);
			await searchInput.setValue("Alice");
			await searchInput.trigger("keydown.enter");
			await flushPromises();

			expect(mockFetchAdminComments).toHaveBeenLastCalledWith(
				{ isApproved: undefined, q: "Alice", dateFrom: undefined, dateTo: undefined },
				1,
				20,
			);
		});

		it("filters by pending status and clears filters back to all", async () => {
			mockFetchAdminComments.mockResolvedValue(mockCommentList);
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// pending status tab
			const pendingTab = wrapper.findAll("button").find((b) => b.text().includes("待审核"));
			expect(pendingTab).toBeDefined();
			await pendingTab?.trigger("click");
			await flushPromises();
			expect(mockFetchAdminComments).toHaveBeenLastCalledWith(
				{ isApproved: false, q: undefined, dateFrom: undefined, dateTo: undefined },
				1,
				20,
			);

			// clear filters back to all
			mockFetchAdminComments.mockClear();
			const clearBtn = wrapper.findAll("button").find((b) => b.text().trim() === "清除");
			expect(clearBtn).toBeDefined();
			await clearBtn?.trigger("click");
			await flushPromises();
			expect(mockFetchAdminComments).toHaveBeenLastCalledWith(
				{ isApproved: undefined, q: undefined, dateFrom: undefined, dateTo: undefined },
				1,
				20,
			);
		});
	});

	describe("Deep-dive polish (round 254)", () => {
		beforeEach(() => {
			mockFetchAdminComments.mockResolvedValue(mockCommentList);
		});

		it("clamps back after deleting the only comment on the last page (deep-dive)", async () => {
			// Deleting the single comment on the last page strands on an
			// out-of-range page unless the page clamps back — otherwise the
			// moderator sees a false "暂无评论" over a list that still exists.
			// After the delete the world shrinks to 20 comments / 1 page, and the
			// clamp's re-fetch of page 1 reflects that (total 20, total_pages 1).
			window.confirm = vi.fn(() => true);
			mockDeleteAdminComment.mockResolvedValue({});
			const page1 = {
				items: [mockComments[0]],
				pagination: { total: 21, page: 1, limit: 20, total_pages: 2 },
			};
			const page2 = {
				items: [{ ...mockComments[1], id: 3, content: "Page 2 only", is_approved: true }],
				pagination: { total: 21, page: 2, limit: 20, total_pages: 2 },
			};
			const page1PostDelete = {
				items: [mockComments[0]],
				pagination: { total: 20, page: 1, limit: 20, total_pages: 1 },
			};
			let drained = false;
			mockFetchAdminComments.mockImplementation((_f: unknown, page: number) => {
				if (page === 2) {
					return Promise.resolve(
						drained
							? { items: [], pagination: { total: 20, page: 2, limit: 20, total_pages: 1 } }
							: page2,
					);
				}
				return Promise.resolve(drained ? page1PostDelete : page1);
			});

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);
			const nextButton = wrapper.findAll("button").find((b) => b.text().trim() === "下一页");
			await nextButton?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("第 2 / 2 页");

			drained = true;
			const deleteBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除");
			await deleteBtn?.trigger("click");
			await flushPromises();

			// Clamped back to the (now single) page 1 instead of a false
			// "暂无评论": the remaining comment from page 1 renders, the empty
			// state is gone, and the nav (hidden for a single page) confirms the
			// list no longer claims two pages.
			expect(wrapper.text()).toContain("Test Post Title");
			expect(wrapper.text()).not.toContain("第 2 /");
			expect(wrapper.text()).not.toContain("暂无评论");
		});

		it("marks exactly one status filter as pressed (deep-dive)", async () => {
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			const chips = wrapper.findAll("[aria-pressed]");
			expect(chips).toHaveLength(4);
			// Default: only "全部" is pressed.
			expect(chips.map((c) => c.attributes("aria-pressed"))).toEqual([
				"true",
				"false",
				"false",
				"false",
			]);

			await chips[1].trigger("click"); // 待审核
			await flushPromises();
			const after = wrapper.findAll("[aria-pressed]");
			expect(after.map((c) => c.attributes("aria-pressed"))).toEqual([
				"false",
				"true",
				"false",
				"false",
			]);
		});

		it("clears a moderated comment out of the batch selection (deep-dive)", async () => {
			// Approving a selected pending comment under the pending filter makes
			// it leave the page; its stale id must not keep the batch buttons
			// claiming a selection that no longer exists (batch-deleting it would
			// just 404).
			mockApproveAdminComment.mockResolvedValue({});
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			const checkboxes = wrapper.findAll('input[type="checkbox"]');
			await checkboxes[checkboxes.length - 1].setChecked(); // Bob (pending)
			await flushPromises();
			expect(wrapper.findAll("button").some((b) => b.text().trim().includes("批量通过 (1)"))).toBe(
				true,
			);

			const approveButton = wrapper.findAll("button").find((b) => b.text().trim() === "通过");
			await approveButton?.trigger("click");
			await flushPromises();

			// Selection is empty again → the batch bar is gone.
			expect(wrapper.findAll("button").some((b) => b.text().trim().includes("批量通过"))).toBe(
				false,
			);
		});

		it("clears the deleted-count feedback once the filter changes (deep-dive)", async () => {
			// After a batch delete the "已删除 N 条评论" feedback must not linger
			// over a totally different, later filtered list.
			mockBatchDeleteAdminComments.mockResolvedValue({ deleted: 2 });
			window.confirm = vi.fn(() => true);
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			await wrapper.find('input[type="checkbox"]').setChecked(); // select all
			await flushPromises();
			const deleteBtn = wrapper.findAll("button").find((b) => b.text().trim().includes("删除所选"));
			await deleteBtn?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("已删除 2 条评论");

			const searchInput = wrapper.find('input[placeholder*="昵称"]');
			await searchInput.setValue("zzzz");
			await searchInput.trigger("keydown.enter");
			await flushPromises();
			expect(wrapper.text()).not.toContain("已删除 2 条评论");
		});

		it("asks before discarding an unsent reply draft when switching (deep-dive)", async () => {
			// Two approved comments → two reply buttons. Typing a draft in the
			// first box and clicking reply on the second must ask before dropping
			// the draft; declining keeps the first box and its text.
			const confirmMock = vi.fn(() => false);
			window.confirm = confirmMock;
			mockFetchAdminComments.mockImplementation(async () => ({
				items: [mockComments[0], { ...mockComments[1], is_approved: true }],
				pagination: mockCommentList.pagination,
			}));

			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			const replyButtons = () =>
				wrapper.findAll("button").filter((b) => b.text().trim() === "回复");
			const buttons = replyButtons(); // capture both BEFORE the box opens
			expect(buttons.length).toBe(2);
			await buttons[0].trigger("click");
			const textarea = wrapper.find("textarea");
			await textarea.setValue("a draft");

			// The second row's button still reads 回复 (row 1 now shows 取消).
			await buttons[1].trigger("click");
			expect(confirmMock).toHaveBeenCalledTimes(1);
			// Declined → the original box stays open with the draft intact.
			expect(wrapper.find("textarea").exists()).toBe(true);
			expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("a draft");
		});

		it("keeps an open reply draft when a DIFFERENT row is moderated (deep-dive)", async () => {
			// A reply draft must not be wiped by the reload that follows
			// approving/revoking some OTHER comment — the box only closes when its
			// own row leaves the page (deep-dive finding).
			mockApproveAdminComment.mockResolvedValue({});
			const CommentsPage = await loadPage();
			const wrapper = await mountWithSuspense(CommentsPage);

			// Alice (approved) has the reply action; Bob (pending) has 通过.
			await wrapper
				.findAll("button")
				.find((b) => b.text().trim() === "回复")
				?.trigger("click");
			const textarea = wrapper.find("textarea");
			await textarea.setValue("a draft");

			await wrapper
				.findAll("button")
				.find((b) => b.text().trim() === "通过")
				?.trigger("click");
			await flushPromises();

			// The reload kept Alice on the page, so her box stays open, draft intact.
			expect(wrapper.find("textarea").exists()).toBe(true);
			expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("a draft");
		});
	});
});
