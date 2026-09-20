/** Reader /newsletter/confirm page tests (DEC-351, TASK-401). */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page dynamic-imports the API helpers; mock them to observe the calls.
const confirmNewsletter = vi.fn();
const setNewsletterDigest = vi.fn();
vi.mock("~~/api/public/newsletter", () => ({ confirmNewsletter, setNewsletterDigest }));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

let routeQuery: Record<string, unknown> = {};
vi.stubGlobal("useRoute", () => ({ query: routeQuery }));

import NewsletterConfirm from "../../app/pages/newsletter/confirm.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
};

function mountPage(query: Record<string, unknown> = {}) {
	routeQuery = query;
	return mount(NewsletterConfirm, { global: { stubs } });
}

describe("newsletter confirm page", () => {
	beforeEach(() => {
		confirmNewsletter.mockReset();
		setNewsletterDigest.mockReset();
	});

	it("shows the invalid-link message when no token is present", async () => {
		const wrapper = mountPage({});
		await flushPromises();
		expect(confirmNewsletter).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("这个确认链接无效，或已经被使用过。");
	});

	it("posts the token once and shows success", async () => {
		confirmNewsletter.mockResolvedValue({ confirmed: true, digest_weekly: false });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		expect(confirmNewsletter).toHaveBeenCalledTimes(1);
		expect(confirmNewsletter).toHaveBeenCalledWith("tok-123");
		expect(wrapper.text()).toContain("订阅成功！");
	});

	it("seeds the cadence checkbox from the confirm response", async () => {
		// A subscribe-time digest opt-in is stored server-side; the confirm
		// response reports it so the box shows the address's real cadence.
		confirmNewsletter.mockResolvedValue({ confirmed: true, digest_weekly: true });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);
	});

	it("ignores a second toggle while one is in flight", async () => {
		confirmNewsletter.mockResolvedValue({ confirmed: true, digest_weekly: false });
		setNewsletterDigest.mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve({ digest_weekly: true }), 50)),
		);
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		const checkbox = wrapper.find('input[type="checkbox"]');
		await checkbox.setValue(true);
		await checkbox.setValue(true); // must be dropped while the first is pending
		await new Promise((resolve) => setTimeout(resolve, 80));
		await flushPromises();

		expect(setNewsletterDigest).toHaveBeenCalledTimes(1);
	});

	it("shows a failure and snaps the checkbox back when the toggle errors", async () => {
		confirmNewsletter.mockResolvedValue({ confirmed: true, digest_weekly: false });
		setNewsletterDigest.mockRejectedValue(new Error("boom"));
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		await wrapper.find('input[type="checkbox"]').setValue(true);
		await flushPromises();

		expect(wrapper.text()).toContain("切换失败");
		// The box snaps back to the server-known state (per-post, unchecked).
		expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(
			false,
		);
	});

	it("shows the invalid state when the token is unknown/used (404)", async () => {
		confirmNewsletter.mockRejectedValue({ response: { status: 404 } });
		const wrapper = mountPage({ token: "tok-404" });
		await flushPromises();

		expect(confirmNewsletter).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("这个确认链接无效，或已经被使用过。");
	});

	it("tells an unsubscribed address to re-subscribe instead of retry (400, round 393)", async () => {
		// The backend 400s a replayed confirm link on a deliberately
		// unsubscribed address; before this fix the page mapped it to the
		// "network" state and told the holder to click a link that can never
		// work again.
		confirmNewsletter.mockRejectedValue({
			response: { status: 400 },
			data: { message: "This address was unsubscribed" },
		});
		const wrapper = mountPage({ token: "tok-unsub" });
		await flushPromises();

		expect(confirmNewsletter).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("该邮箱此前已退订");
		// NOT the network retry line.
		expect(wrapper.text()).not.toContain("暂时无法连接服务器");
	});

	it("shows a network error (not 'invalid link') when the backend is unreachable", async () => {
		confirmNewsletter.mockRejectedValue(
			new Error("FetchError: request to /api/newsletter/confirm failed"),
		);
		const wrapper = mountPage({ token: "tok-net" });
		await flushPromises();

		expect(confirmNewsletter).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("暂时无法连接服务器");
		// Crucially NOT the "invalid/used" claim — the token may still be live.
		expect(wrapper.text()).not.toContain("这个确认链接无效，或已经被使用过。");
	});

	it("toggles the weekly-digest cadence with the same token once confirmed", async () => {
		confirmNewsletter.mockResolvedValue({ confirmed: true });
		setNewsletterDigest.mockResolvedValue({ digest_weekly: true });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		await wrapper.find('input[type="checkbox"]').setValue(true);
		await flushPromises();

		expect(setNewsletterDigest).toHaveBeenCalledTimes(1);
		expect(setNewsletterDigest).toHaveBeenCalledWith("tok-123", true);
		expect(wrapper.text()).toContain("改为每周收到一次汇总邮件");
		expect(wrapper.text()).not.toContain("切换失败");
	});
});
