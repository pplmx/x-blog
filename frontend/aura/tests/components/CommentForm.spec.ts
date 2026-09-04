/**
 * CommentForm component tests
 * Tests form rendering, input binding, validation (empty fields),
 * submission flow (success and error paths), and loading state.
 *
 * Mocks the public comments API module to control the
 * submission result without hitting the backend.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the API module before importing the component.
const { mockCreateComment } = vi.hoisted(() => ({
	mockCreateComment: vi.fn(),
}));
vi.mock("~~/api/public/comments", () => ({
	createComment: mockCreateComment,
}));

import CommentForm from "../../components/CommentForm.vue";

async function mountCommentForm({
	postId = 1,
	submitResult = "success",
}: {
	postId?: number;
	submitResult?: "success" | "error";
} = {}) {
	mockCreateComment.mockReset();
	if (submitResult === "success") {
		mockCreateComment.mockResolvedValue({});
	} else {
		mockCreateComment.mockRejectedValue(new Error("Network error"));
	}

	const wrapper = mount(CommentForm, {
		props: { postId },
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
	return wrapper;
}

describe("CommentForm", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Dirty-state reporting (deep-dive)", () => {
		// The parent (CommentList) guards reply-target switches by subscribing to
		// `update:dirty` — CommentForm reports whether the reader has unsent text.
		it("emits update:dirty(false) on mount when the form is clean", async () => {
			const wrapper = await mountCommentForm();
			expect(wrapper.emitted("update:dirty")?.at(-1)).toEqual([false]);
		});

		it("emits update:dirty(true) once the reader types, and false again when cleared", async () => {
			const wrapper = await mountCommentForm();
			await wrapper.find("#comment-content").setValue("hello");
			await flushPromises();
			expect(wrapper.emitted("update:dirty")?.at(-1)).toEqual([true]);

			await wrapper.find("#comment-content").setValue("");
			await flushPromises();
			expect(wrapper.emitted("update:dirty")?.at(-1)).toEqual([false]);
		});

		it("emits update:dirty(false) after a successful submit clears the form", async () => {
			const wrapper = await mountCommentForm();
			await wrapper.find("#comment-nickname").setValue("n");
			await wrapper.find("#comment-email").setValue("a@b.c");
			await wrapper.find("#comment-content").setValue("hi");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();
			expect(wrapper.emitted("update:dirty")?.at(-1)).toEqual([false]);
		});
	});

	describe("Rendering", () => {
		it("renders the form title", async () => {
			const wrapper = await mountCommentForm();
			expect(wrapper.text()).toContain("发表评论");
		});

		it("renders nickname input field", async () => {
			const wrapper = await mountCommentForm();
			const nicknameInput = wrapper.find("#comment-nickname");
			expect(nicknameInput.exists()).toBe(true);
			expect(nicknameInput.attributes("placeholder")).toContain("昵称");
		});

		it("renders email input field", async () => {
			const wrapper = await mountCommentForm();
			const emailInput = wrapper.find("#comment-email");
			expect(emailInput.exists()).toBe(true);
			expect(emailInput.attributes("placeholder")).toContain("邮箱");
		});

		it("renders content textarea", async () => {
			const wrapper = await mountCommentForm();
			const textarea = wrapper.find("textarea");
			expect(textarea.exists()).toBe(true);
			expect(textarea.attributes("placeholder")).toContain("写点什么吧");
		});

		it("renders submit button", async () => {
			const wrapper = await mountCommentForm();
			const button = wrapper.find('button[type="submit"]');
			expect(button.exists()).toBe(true);
			expect(button.text()).toContain("提交评论");
		});

		it("renders the Markdown hint under the content box (DEC-088)", async () => {
			const wrapper = await mountCommentForm();
			expect(wrapper.text()).toContain("支持 Markdown");
		});
	});

	describe("Form binding", () => {
		it("binds nickname input to form.nickname", async () => {
			const wrapper = await mountCommentForm();
			const nicknameInput = wrapper.find("#comment-nickname") as any;
			await nicknameInput.setValue("Alice");
			expect(nicknameInput.element.value).toBe("Alice");
		});

		it("binds email input to form.email", async () => {
			const wrapper = await mountCommentForm();
			const emailInput = wrapper.find('input[type="email"]') as any;
			await emailInput.setValue("alice@test.com");
			expect(emailInput.element.value).toBe("alice@test.com");
		});

		it("binds content textarea to form.content", async () => {
			const wrapper = await mountCommentForm();
			const textarea = wrapper.find("textarea") as any;
			await textarea.setValue("Great post!");
			expect(textarea.element.value).toBe("Great post!");
		});
	});

	describe("Validation", () => {
		it("does NOT call createComment when nickname is empty", async () => {
			const wrapper = await mountCommentForm();
			const form = wrapper.find("form");
			await form.trigger("submit.prevent");
			expect(mockCreateComment).not.toHaveBeenCalled();
		});

		it("does NOT call createComment when email is empty", async () => {
			const wrapper = await mountCommentForm();
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			// Don't set email
			await (wrapper.find("textarea") as any).setValue("Content here");
			await wrapper.find("form").trigger("submit.prevent");
			expect(mockCreateComment).not.toHaveBeenCalled();
		});

		it("does NOT call createComment when content is empty", async () => {
			const wrapper = await mountCommentForm();
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			// Don't set content
			await wrapper.find("form").trigger("submit.prevent");
			expect(mockCreateComment).not.toHaveBeenCalled();
		});

		it("submits when all fields are filled", async () => {
			const wrapper = await mountCommentForm();
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(mockCreateComment).toHaveBeenCalledTimes(1);
			expect(mockCreateComment).toHaveBeenCalledWith(1, {
				nickname: "Alice",
				email: "alice@test.com",
				content: "Great post!",
				parent_id: null,
				website: "",
			});
		});
	});

	describe("Double-submit guard (deep-dive)", () => {
		it("does not POST twice when the form is submitted again mid-flight", async () => {
			// The submit BUTTON is disabled while `submitting`, but the native
			// form submit also fires on Enter in the nickname/email inputs, and a
			// fast double-click can beat Vue patching `disabled` in the same
			// frame — a quick second submit must be a no-op, not a second POST.
			const wrapper = await mountCommentForm();
			// mountCommentForm resets the mock on setup, so arm the deferred
			// implementation only now (before any submit triggers one).
			let resolveCreate!: (v: unknown) => void;
			mockCreateComment.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveCreate = resolve;
					}),
			);
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");

			await wrapper.find("form").trigger("submit.prevent");
			await wrapper.find("form").trigger("submit.prevent");
			await wrapper.find("form").trigger("submit.prevent");
			// Nothing resolved yet — all three submits were in-flight together.
			expect(mockCreateComment).toHaveBeenCalledTimes(1);

			resolveCreate({});
			await flushPromises();
			expect(mockCreateComment).toHaveBeenCalledTimes(1);
		});
	});

	describe("Submission success", () => {
		it("shows success message after successful submission", async () => {
			const wrapper = await mountCommentForm();
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("评论提交成功");
		});

		it("clears the form after successful submission", async () => {
			const wrapper = await mountCommentForm();
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect((wrapper.find("#comment-nickname") as any).element.value).toBe("");
			expect((wrapper.find('input[type="email"]') as any).element.value).toBe("");
			expect((wrapper.find("textarea") as any).element.value).toBe("");
		});

		it("hides success message on the next error", async () => {
			// First, do a successful submission
			mockCreateComment.mockResolvedValue({});
			let wrapper = await mountCommentForm({ postId: 1 });
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("评论提交成功");
			expect(wrapper.text()).not.toContain("Network error");

			// Now do an error submission — need to re-mount since form is cleared
			mockCreateComment.mockRejectedValue(new Error("Network error"));
			wrapper = await mountCommentForm({ postId: 1, submitResult: "error" });
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			// Error message should appear, success should not
			expect(wrapper.text()).toContain("Network error");
			expect(wrapper.text()).not.toContain("评论提交成功");
		});
	});

	describe("Submission error", () => {
		it("shows error message when submission fails", async () => {
			const wrapper = await mountCommentForm({ submitResult: "error" });
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			// Component shows the error message: e?.message || '评论提交失败，请重试。'
			expect(wrapper.text()).toContain("Network error");
		});

		it("shows error message with the error text", async () => {
			const wrapper = await mountCommentForm({ submitResult: "error" });
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			// The component displays e?.message when the error has a message
			expect(wrapper.text()).toContain("Network error");
		});
	});

	describe("Loading state", () => {
		it("disables submit button while submitting", async () => {
			// Create a promise that we control so we can test the loading state
			const submitPromise = new Promise(() => {}); // never resolves

			const wrapper = await mountCommentForm({ postId: 1 });
			// Override the mock after mount to return a pending promise
			mockCreateComment.mockReturnValue(submitPromise);

			// Set fields
			await (wrapper.find("#comment-nickname") as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");

			// Submit (don't await — we want to catch the loading state)
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises(); // let the submit handler start

			const button = wrapper.find('button[type="submit"]');
			expect(button.attributes("disabled")).toBeDefined();
			// The success message should NOT appear yet (still loading)
			expect(wrapper.text()).not.toContain("评论提交成功");
		});
	});

	describe("Reply-target draft protection", () => {
		it("keeps a typed draft across a parentId prop change — the form never wipes unsent text unilaterally", async () => {
			// The old design confirmed inside a parentId watch — but every reply
			// form is a FRESH instance mounted inside `v-if="replyTo?.id ===
			// comment.id"`, so re-targeting replaces the instance before that
			// watch can fire: the protection was structurally dead and a draft
			// vanished silently. The guard now lives in CommentList on the
			// actual transition (see CommentList.spec "Reply draft
			// protection"); CommentForm is a passive dirty reporter and must
			// never destroy unsent text on a bare prop change.
			const wrapper = await mountCommentForm({ postId: 1 });
			const confirmMock = vi.fn(() => false);
			vi.stubGlobal("confirm", confirmMock);

			await wrapper.find("textarea").setValue("Half-typed reply");
			await wrapper.setProps({ parentId: 7 });
			expect(confirmMock).not.toHaveBeenCalled();
			expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe(
				"Half-typed reply",
			);
			vi.unstubAllGlobals();
		});
	});
});
