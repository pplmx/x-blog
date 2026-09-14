/**
 * NewsletterSubscribe component tests (DEC-351, TASK-401).
 *
 * Verifies the footer "email me new posts" form: it POSTs the entered address
 * once (generic backend response), clears the field and shows success; a
 * failure shows an error message and does not clear; a no-email submit is a
 * no-op (HTML required + guard); double-submitting is prevented mid-flight.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));

const subscribeNewsletter = vi.fn();
vi.mock("~~/api/public/newsletter", () => ({ subscribeNewsletter }));

import NewsletterSubscribe from "../../components/NewsletterSubscribe.vue";

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

describe("NewsletterSubscribe", () => {
	beforeEach(() => {
		subscribeNewsletter.mockReset();
	});

	async function mountForm(initialEmail = "") {
		const wrapper = mount(NewsletterSubscribe, {
			global: { stubs: { Icon: iconStub } },
		});
		if (initialEmail) {
			// setValue drives the v-model (a raw element.value assignment never
			// reaches the component's email ref).
			await wrapper.find("#newsletter-email").setValue(initialEmail);
		}
		return wrapper;
	}

	it("POSTs the entered email once and shows success", async () => {
		subscribeNewsletter.mockResolvedValue({ subscribed: true, message: "..." });
		const wrapper = await mountForm("reader@example.com");

		await wrapper.find("form").trigger("submit");
		await flushPromises();

		expect(subscribeNewsletter).toHaveBeenCalledTimes(1);
		expect(subscribeNewsletter).toHaveBeenCalledWith("reader@example.com");
		expect(wrapper.text()).toContain("components.newsletter.done");
		// The field clears after a successful submit.
		expect((wrapper.find("#newsletter-email").element as HTMLInputElement).value).toBe("");
	});

	it("does not submit an empty email", async () => {
		const wrapper = await mountForm();
		await wrapper.find("form").trigger("submit");
		await flushPromises();
		expect(subscribeNewsletter).not.toHaveBeenCalled();
	});

	it("shows an error and keeps the address on failure", async () => {
		subscribeNewsletter.mockRejectedValue(new Error("boom"));
		const wrapper = await mountForm("fail@example.com");

		await wrapper.find("form").trigger("submit");
		await flushPromises();

		expect(wrapper.text()).toContain("components.newsletter.error");
		expect((wrapper.find("#newsletter-email").element as HTMLInputElement).value).toBe(
			"fail@example.com",
		);
	});

	it("clears a stale done/error state when the address is re-edited", async () => {
		subscribeNewsletter.mockRejectedValue(new Error("boom"));
		const wrapper = await mountForm("retry@example.com");

		await wrapper.find("form").trigger("submit");
		await flushPromises();
		expect(wrapper.text()).toContain("components.newsletter.error");

		// Editing the field resets the terminal state so the corrected address
		// isn't shown under the old failure message.
		await wrapper.find("#newsletter-email").setValue("retry2@example.com");
		expect(wrapper.text()).not.toContain("components.newsletter.error");
	});

	it("prevents a second submit while a submit is in flight", async () => {
		let resolveFn: ((v: unknown) => void) | undefined;
		subscribeNewsletter.mockImplementation(() => new Promise((resolve) => (resolveFn = resolve)));
		const wrapper = await mountForm("slow@example.com");

		await wrapper.find("form").trigger("submit"); // starts, not yet resolved
		// Let the first handler set `submitting` before the second submit fires
		// (the in-flight guard must already be true).
		await flushPromises();
		await wrapper.find("form").trigger("submit"); // must be ignored while in flight
		expect(subscribeNewsletter).toHaveBeenCalledTimes(1);

		resolveFn?.({ subscribed: true, message: "" });
		await flushPromises();
		expect(wrapper.text()).toContain("components.newsletter.done");
	});
});
