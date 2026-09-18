/**
 * GuestThreadFollow component tests (DEC-427, TASK-438).
 *
 * The compact guest email thread-follow form on the post comment header: it
 * POSTs the entered address to the guest thread-follow endpoint once, shows a
 * "check your inbox" state (the backend is deliberately no-oracle), an empty
 * submit is a no-op (HTML required + guard), double-submitting is prevented
 * mid-flight, and the whole control renders nothing for signed-in readers
 * (the push thread-follow covers them).
 */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));

// Auth state drives the guest-only render (v-if="!isAuthenticated").
const isAuthenticated = ref(false);
vi.mock("~~/composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated }),
}));

const subscribeGuestThread = vi.fn();
vi.mock("~~/api/public/comments", () => ({ subscribeGuestThread }));

import GuestThreadFollow from "../../components/GuestThreadFollow.vue";

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

describe("GuestThreadFollow", () => {
	beforeEach(() => {
		subscribeGuestThread.mockReset();
		isAuthenticated.value = false;
	});

	async function mountForm(postId = 42) {
		return mount(GuestThreadFollow, {
			props: { postId },
			global: { stubs: { Icon: iconStub } },
		});
	}

	it("renders the email form for guests", async () => {
		const wrapper = await mountForm();
		expect(wrapper.find("form").exists()).toBe(true);
		expect(wrapper.find('input[type="email"]').exists()).toBe(true);
	});

	it("renders nothing for signed-in readers (push thread-follow covers them)", async () => {
		isAuthenticated.value = true;
		const wrapper = await mountForm();
		expect(wrapper.find("form").exists()).toBe(false);
		expect(wrapper.text()).toBe("");
	});

	it("POSTs the email to the thread-follow endpoint on submit", async () => {
		subscribeGuestThread.mockResolvedValue({ subscribed: true });
		const wrapper = await mountForm(7);

		await wrapper.find('input[type="email"]').setValue("fan@example.com");
		await wrapper.find("form").trigger("submit");
		await flushPromises();

		expect(subscribeGuestThread).toHaveBeenCalledTimes(1);
		expect(subscribeGuestThread).toHaveBeenCalledWith(7, "fan@example.com");
		expect(wrapper.text()).toContain("components.commentList.guestFollow.sent");
	});

	it("ignores an empty email", async () => {
		const wrapper = await mountForm();
		await wrapper.find("form").trigger("submit");
		await flushPromises();
		expect(subscribeGuestThread).not.toHaveBeenCalled();
	});

	it("shows an error message on failure", async () => {
		subscribeGuestThread.mockRejectedValue(new Error("boom"));
		const wrapper = await mountForm();
		await wrapper.find('input[type="email"]').setValue("fail@example.com");
		await wrapper.find("form").trigger("submit");
		await flushPromises();
		expect(wrapper.text()).toContain("components.commentList.guestFollow.error");
		expect(wrapper.text()).not.toContain("components.commentList.guestFollow.sent");
	});

	it("prevents a second submit while one is in flight", async () => {
		let resolveFn: ((v: unknown) => void) | undefined;
		subscribeGuestThread.mockImplementation(() => new Promise((resolve) => (resolveFn = resolve)));
		const wrapper = await mountForm();
		await wrapper.find('input[type="email"]').setValue("slow@example.com");

		await wrapper.find("form").trigger("submit"); // starts, not yet resolved
		await flushPromises();
		await wrapper.find("form").trigger("submit"); // must be ignored while in flight
		expect(subscribeGuestThread).toHaveBeenCalledTimes(1);

		resolveFn?.({ subscribed: true });
		await flushPromises();
		expect(wrapper.text()).toContain("components.commentList.guestFollow.sent");
	});
});
