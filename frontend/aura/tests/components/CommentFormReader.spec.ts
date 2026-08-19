/** CommentForm reader-identity behavior (DEC-062, TASK-136). */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const { mockCreateComment } = vi.hoisted(() => ({
	mockCreateComment: vi.fn(),
}));
vi.mock("~/composables/useApi", () => ({
	createComment: mockCreateComment,
}));

const isAuth = ref(false);
const reader = ref<{ id: number; email: string; display_name: string | null } | null>(null);
vi.mock("~~/composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated: isAuth, reader }),
}));

import CommentForm from "../../components/CommentForm.vue";

async function mountForm() {
	mockCreateComment.mockReset().mockResolvedValue({});
	return mount(CommentForm, {
		props: { postId: 7 },
		global: {
			stubs: {
				Icon: { template: '<svg class="iconstub" :data-icon="icon"></svg>', props: ["icon"] },
			},
		},
	});
}

describe("CommentForm reader identity", () => {
	afterEach(() => {
		isAuth.value = false;
		reader.value = null;
		vi.restoreAllMocks();
	});

	it("shows identity line (no nickname/email) when signed in", async () => {
		isAuth.value = true;
		reader.value = { id: 1, email: "r@example.com", display_name: "Riki" };
		const wrapper = await mountForm();
		expect(wrapper.find("#reader-comment-identity").exists()).toBe(true);
		expect(wrapper.find("#comment-nickname").exists()).toBe(false);
		expect(wrapper.find("#comment-email").exists()).toBe(false);
	});

	it("submits account identity when signed in", async () => {
		isAuth.value = true;
		reader.value = { id: 1, email: "r@example.com", display_name: "Riki" };
		const wrapper = await mountForm();
		await wrapper.find("textarea").setValue("A signed-in comment");
		await wrapper.find("form").trigger("submit.prevent");
		await flushPromises();
		expect(mockCreateComment).toHaveBeenCalledWith(7, {
			nickname: "Riki",
			email: "",
			content: "A signed-in comment",
			parent_id: null,
			website: "",
		});
	});

	it("requires no name/email when signed in (content only)", async () => {
		isAuth.value = true;
		reader.value = { id: 1, email: "r@example.com", display_name: "Riki" };
		const wrapper = await mountForm();
		await wrapper.find("textarea").setValue("Just content");
		await wrapper.find("form").trigger("submit.prevent");
		await flushPromises();
		expect(mockCreateComment).toHaveBeenCalled();
	});

	it("keeps anonymous nickname/email inputs when signed out", async () => {
		const wrapper = await mountForm();
		expect(wrapper.find("#reader-comment-identity").exists()).toBe(false);
		expect(wrapper.find("#comment-nickname").exists()).toBe(true);
		expect(wrapper.find("#comment-email").exists()).toBe(true);
	});
});
