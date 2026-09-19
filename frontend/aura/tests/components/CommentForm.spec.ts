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
const { mockCreateComment, mockSuggest } = vi.hoisted(() => ({
	mockCreateComment: vi.fn(),
	mockSuggest: vi.fn(),
}));
vi.mock("~~/api/public/comments", () => ({
	createComment: mockCreateComment,
}));
vi.mock("~~/api/public/readers", () => ({
	suggestMentionReaders: mockSuggest,
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
			await wrapper.find("textarea").setValue("hello");
			await flushPromises();
			expect(wrapper.emitted("update:dirty")?.at(-1)).toEqual([true]);

			await wrapper.find("textarea").setValue("");
			await flushPromises();
			expect(wrapper.emitted("update:dirty")?.at(-1)).toEqual([false]);
		});

		it("emits update:dirty(false) after a successful submit clears the form", async () => {
			const wrapper = await mountCommentForm();
			await wrapper.find('input[autocomplete="nickname"]').setValue("n");
			await wrapper.find('input[autocomplete="email"]').setValue("a@b.c");
			await wrapper.find("textarea").setValue("hi");
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
			const nicknameInput = wrapper.find('input[autocomplete="nickname"]');
			expect(nicknameInput.exists()).toBe(true);
			expect(nicknameInput.attributes("placeholder")).toContain("昵称");
		});

		it("renders email input field", async () => {
			const wrapper = await mountCommentForm();
			const emailInput = wrapper.find('input[autocomplete="email"]');
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
			const nicknameInput = wrapper.find('input[autocomplete="nickname"]') as any;
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
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			// Don't set email
			await (wrapper.find("textarea") as any).setValue("Content here");
			await wrapper.find("form").trigger("submit.prevent");
			expect(mockCreateComment).not.toHaveBeenCalled();
		});

		it("does NOT call createComment when content is empty", async () => {
			const wrapper = await mountCommentForm();
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			// Don't set content
			await wrapper.find("form").trigger("submit.prevent");
			expect(mockCreateComment).not.toHaveBeenCalled();
		});

		it("submits when all fields are filled", async () => {
			const wrapper = await mountCommentForm();
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
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
				// Guest reply-email consent defaults OFF (DEC-332): a guest who
				// doesn't tick the box is never emailed about replies.
				reply_notify_email: false,
			});
		});
	});

	describe("Guest reply-email consent (DEC-332)", () => {
		const checkbox = (wrapper: ReturnType<typeof mountCommentForm>) =>
			wrapper.find('input[type="checkbox"]') as any;

		it("renders an unchecked opt-in checkbox in the guest form", async () => {
			const wrapper = await mountCommentForm();
			expect(checkbox(wrapper).exists()).toBe(true);
			expect((checkbox(wrapper).element as HTMLInputElement).checked).toBe(false);
		});

		it("submits reply_notify_email=true when the box is ticked", async () => {
			const wrapper = await mountCommentForm();
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await checkbox(wrapper).setValue(true);
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(mockCreateComment).toHaveBeenCalledTimes(1);
			expect(mockCreateComment).toHaveBeenCalledWith(
				1,
				expect.objectContaining({ reply_notify_email: true }),
			);
		});

		it("resets the box after a successful submit", async () => {
			const wrapper = await mountCommentForm();
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await checkbox(wrapper).setValue(true);
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect((checkbox(wrapper).element as HTMLInputElement).checked).toBe(false);
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
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
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
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("评论提交成功");
		});

		it("clears the form after successful submission", async () => {
			const wrapper = await mountCommentForm();
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect((wrapper.find('input[autocomplete="nickname"]') as any).element.value).toBe("");
			expect((wrapper.find('input[type="email"]') as any).element.value).toBe("");
			expect((wrapper.find("textarea") as any).element.value).toBe("");
		});

		it("hides success message on the next error", async () => {
			// First, do a successful submission
			mockCreateComment.mockResolvedValue({});
			let wrapper = await mountCommentForm({ postId: 1 });
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("评论提交成功");
			expect(wrapper.text()).not.toContain("Network error");

			// Now do an error submission — need to re-mount since form is cleared
			mockCreateComment.mockRejectedValue(new Error("Network error"));
			wrapper = await mountCommentForm({ postId: 1, submitResult: "error" });
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			// Localized failure should appear, success should not
			expect(wrapper.text()).toContain("评论提交失败，请重试。");
			expect(wrapper.text()).not.toContain("评论提交成功");
		});
	});

	describe("Submission error (usability deep-dive fix)", () => {
		// command() rethrows the raw FetchError whose .message is the technical
		// "[POST] \"...\": 429 Too Many Requests" string. The form must NEVER show
		// that to a commenter: predictable conditions get localized text and any
		// other failure falls back to the backend's human envelope message.
		it("shows the localized fallback for a message-less failure (no raw technical string)", async () => {
			// A plain Error() has no status and no envelope body → submitFailed.
			const wrapper = await mountCommentForm({ submitResult: "error" });
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("评论提交失败，请重试。");
			expect(wrapper.text()).not.toContain("Network error");
		});

		it("surfaces the backend's human envelope message, not the technical string", async () => {
			// FetchError shape from command(): the raw .message is the technical
			// string; the human text rides .data.error.message. Set the shaped
			// rejection AFTER mount — the mount helper (re)arms the mock.
			// (400 keeps the envelope branch live — 403/429 short-circuit to their
			// localized lines.)
			const wrapper = await mountCommentForm();
			mockCreateComment.mockRejectedValue({
				message: '[POST] "http://x/api/comments/post/1": 400 Bad Request',
				statusCode: 400,
				data: { error: { message: "This comment contains disallowed content" } },
			});
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("This comment contains disallowed content");
			// The raw technical string must not leak.
			expect(wrapper.text()).not.toContain('"http://x/api/comments/post/1"');
		});

		it("maps a 429 rate-limit rejection to localized text", async () => {
			const wrapper = await mountCommentForm();
			mockCreateComment.mockRejectedValue({
				message: '[POST] "http://x/api/comments/post/1": 429 Too Many Requests',
				statusCode: 429,
				data: { error: { message: "Too many requests. Please try again later." } },
			});
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("评论过于频繁，请稍后再试。");
			expect(wrapper.text()).not.toContain("Too Many Requests");
		});

		it("maps a 403 closed-comments rejection to localized text", async () => {
			const wrapper = await mountCommentForm();
			mockCreateComment.mockRejectedValue({
				message: '[POST] "http://x/api/comments/post/1": 403 Forbidden',
				statusCode: 403,
				data: { error: { message: "Comments are closed on this post" } },
			});
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("这篇文章的评论区已关闭。");
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
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
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

	describe("Per-instance field ids (round 278)", () => {
		it("gives coexisting forms distinct field ids so labels bind within their own form", async () => {
			// A post page mounts the standalone bottom form and (while open) an
			// inline reply form at once. Duplicate `comment-nickname`/`comment-
			// content` etc. made `label for` resolve to the FIRST element in
			// document order — clicking one form's label focused the other's
			// textarea — and broke WCAG 4.1.1 (unique id values).
			mockCreateComment.mockReset().mockResolvedValue({});
			const wrapper = mount(
				{
					components: { CommentForm },
					template: "<div><CommentForm :post-id='1'/><CommentForm :post-id='1'/></div>",
				},
				{
					attachTo: document.body,
					global: {
						stubs: {
							Icon: { template: '<svg class="iconstub" />', props: ["icon"] },
						},
					},
				},
			);
			await flushPromises();

			// Two nickname inputs, each with its own unique id…
			const nicknameIds = [...document.querySelectorAll('input[autocomplete="nickname"]')].map(
				(el) => el.id,
			);
			expect(nicknameIds.length).toBe(2);
			expect(new Set(nicknameIds).size).toBe(2);
			// …and no id on the page is duplicated (WCAG 4.1.1 first test)…
			const allIds = [...document.querySelectorAll("[id]")].map((el) => el.id);
			const dupes = allIds.filter((v, i) => allIds.indexOf(v) !== i);
			expect(dupes).toEqual([]);
			// …each label's for targets an input in its own form (both textareas
			// find their own label, not the sibling form's).
			for (const ta of document.querySelectorAll("textarea")) {
				expect(document.querySelector(`label[for="${ta.id}"]`)).not.toBeNull();
			}
			wrapper.unmount();
		});
	});

	describe("disabled prop (mid-refetch guard, ISS-416)", () => {
		// The post page disables the comment form while the main post is mid-SPA-
		// refetch (prev/next): submitting in that window would attach the comment
		// to the OLD post the reader is still looking at.
		it("renders the submit button disabled and never POSTs", async () => {
			const wrapper = mount(CommentForm, {
				props: { postId: 1, disabled: true },
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
			expect(wrapper.find('button[type="submit"]').attributes("disabled")).toBeDefined();
			// A full form submit while disabled must not reach the API.
			await (wrapper.find('input[autocomplete="nickname"]') as any).setValue("Alice");
			await (wrapper.find('input[type="email"]') as any).setValue("alice@test.com");
			await (wrapper.find("textarea") as any).setValue("Great post!");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();
			expect(mockCreateComment).not.toHaveBeenCalled();
			wrapper.unmount();
		});
	});
});

describe("Markdown live preview (DEC-306/TASK-381)", () => {
	it("renders the Write/Preview tab switch with a preview panel", async () => {
		const wrapper = await mountCommentForm();
		const textarea = () => wrapper.find("textarea");
		expect(textarea().exists()).toBe(true);

		// Defaults to the write tab; preview pane is not rendered yet.
		expect(wrapper.find(".comment-preview").exists()).toBe(false);

		// Switch to Preview with nothing typed → empty-state message.
		await wrapper.find('button[role="tab"][data-tab="preview"]').trigger("click");
		await flushPromises();
		expect(textarea().exists()).toBe(false);
		expect(wrapper.find(".comment-preview").exists()).toBe(true);
		expect(wrapper.find(".comment-preview p").text()).toContain("Markdown");
	});

	it("renders the draft as sanitized Markdown: bold, links and fenced code", async () => {
		const wrapper = await mountCommentForm();
		await (wrapper.find("textarea") as any).setValue(
			"**bold** and [a link](https://example.com) and a fence:\n\n```ts\nconst x = 1;\n```",
		);
		await wrapper.find('button[role="tab"][data-tab="preview"]').trigger("click");
		await flushPromises();

		const preview = wrapper.find(".comment-preview");
		expect(preview.find("strong").text()).toBe("bold");
		expect(preview.find('a[href="https://example.com"]').exists()).toBe(true);
		// The fence renders as a code block (highlighting is a lazy, visual
		// pass — the <pre><code> structure comes straight from the markdown
		// pipeline and must already exist).
		expect(preview.find("pre code.language-ts").exists()).toBe(true);
		expect(preview.find("pre code.language-ts").text()).toContain("const x = 1;");
	});

	it("keeps the draft in the textarea when toggling back to Write", async () => {
		const wrapper = await mountCommentForm();
		const draft = "**kept** after toggle";
		await (wrapper.find("textarea") as any).setValue(draft);
		await wrapper.find('button[role="tab"][data-tab="preview"]').trigger("click");
		await flushPromises();
		await wrapper.find('button[role="tab"][data-tab="write"]').trigger("click");
		await flushPromises();

		const textarea = wrapper.find("textarea");
		expect(textarea.exists()).toBe(true);
		expect((textarea.element as HTMLTextAreaElement).value).toBe(draft);
	});

	it("sanitizes XSS payloads in the preview (same pipeline as the list)", async () => {
		const wrapper = await mountCommentForm();
		const payload = 'hello <script>window.__xss=1</script> <img src=x onerror="alert(1)">';
		await (wrapper.find("textarea") as any).setValue(payload);
		await wrapper.find('button[role="tab"][data-tab="preview"]').trigger("click");
		await flushPromises();

		const preview = wrapper.find(".comment-preview");
		expect(preview.find("script").exists()).toBe(false);
		expect(preview.find("[onerror]").exists()).toBe(false);
		expect(wrapper.element.querySelector("script")).toBeNull();
		// The safe text survives the sanitizer (happy-dom normalizes attribute
		// quoting, so assert on text + absence of live handlers, not bytes).
		expect(preview.text()).toContain("hello");
		// The preview is driven by the SAME renderer the list ships — the
		// component feeds commentMarkdownToHtml, so hand a hostile payload and
		// confirm the headless function also strips it (no drifting pipelines).
		const { commentMarkdownToHtml } = await import("~~/composables/useMarkdown");
		const sanitized = commentMarkdownToHtml(payload);
		expect(sanitized).not.toContain("<script");
		expect(sanitized).not.toContain("onerror");
	});

	it("a successful submit while previewing switches back to a clean Write tab", async () => {
		const wrapper = await mountCommentForm();
		await wrapper.find('input[autocomplete="nickname"]').setValue("n");
		await wrapper.find('input[type="email"]').setValue("a@b.c");
		await (wrapper.find("textarea") as any).setValue("nice post");
		await wrapper.find('button[role="tab"][data-tab="preview"]').trigger("click");
		await flushPromises();

		await wrapper.find('button[type="submit"]').trigger("submit");
		await flushPromises();
		expect(mockCreateComment).toHaveBeenCalledTimes(1);
		// Form cleared and back on the Write tab.
		expect(wrapper.find("textarea").exists()).toBe(true);
		expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("");
	});

	describe("@-mention picker (DEC-324)", () => {
		const riki = { id: 1, display_name: "Riki", avatar_url: null };
		const aria = { id: 2, display_name: "Aria", avatar_url: null };

		beforeEach(() => {
			mockSuggest.mockReset();
			mockSuggest.mockResolvedValue([riki, aria]);
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		async function openPicker(value = "Hey @") {
			const wrapper = await mountCommentForm();
			const ta = wrapper.find("textarea");
			await ta.setValue(value);
			await vi.advanceTimersByTimeAsync(250);
			await flushPromises();
			return wrapper;
		}

		it("shows reader suggestions + the typed query when '@' is typed", async () => {
			const wrapper = await openPicker("See @ri");
			expect(mockSuggest).toHaveBeenCalledWith("ri");
			const ta = wrapper.find("textarea");
			expect(ta.attributes("aria-expanded")).toBe("true");
			const options = wrapper.findAll('[data-testid="mention-option"]');
			expect(options.map((o) => o.find('[data-testid="mention-name"]').text())).toEqual([
				"Riki",
				"Aria",
			]);
		});

		it("keeps the picker closed when no reader matches", async () => {
			mockSuggest.mockResolvedValue([]);
			const wrapper = await mountCommentForm();
			await wrapper.find("textarea").setValue("Hey @zz");
			await vi.advanceTimersByTimeAsync(250);
			await flushPromises();
			expect(wrapper.findAll('[data-testid="mention-option"]')).toHaveLength(0);
			expect(wrapper.find("textarea").attributes("aria-expanded")).toBe("false");
		});

		it("inserts the highlighted suggestion on Enter with a trailing space", async () => {
			const wrapper = await openPicker();
			const ta = wrapper.find("textarea");
			// ArrowDown highlights "Aria" (index 1), Enter inserts it.
			await ta.trigger("keydown", { key: "ArrowDown" });
			await ta.trigger("keydown", { key: "Enter" });
			await flushPromises();
			// openPicker() typed "Hey @" so the insertion lands mid-draft.
			expect((ta.element as HTMLTextAreaElement).value).toBe("Hey @Aria ");
			expect(wrapper.findAll('[data-testid="mention-option"]')).toHaveLength(0);
			// The picker must not swallow the Enter that should not submit a form.
			expect(mockCreateComment).not.toHaveBeenCalled();
		});

		it("inserts on a click without losing the input caret", async () => {
			const wrapper = await openPicker("Hi @ri");
			const option = wrapper.findAll('[data-testid="mention-option"]')[0];
			await option.trigger("mousedown");
			await flushPromises();
			expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("Hi @Riki ");
		});

		it("Escape closes the picker without cancelling the whole form", async () => {
			const wrapper = await openPicker();
			await wrapper.find("textarea").trigger("keydown", { key: "Escape" });
			await flushPromises();
			expect(wrapper.findAll('[data-testid="mention-option"]')).toHaveLength(0);
			expect(wrapper.emitted("cancel")).toBeUndefined();
		});
	});
});
