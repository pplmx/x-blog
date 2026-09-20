/** Reader /comment-subscribe/confirm page tests (DEC-427, TASK-438). */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page dynamic-imports the API helper; mock it to observe the token call.
const confirmGuestThreadSubscription = vi.fn();
const setGuestThreadDigest = vi.fn();
vi.mock("~~/api/public/comments", () => ({
	confirmGuestThreadSubscription,
	setGuestThreadDigest,
}));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

let routeQuery: Record<string, unknown> = {};
vi.stubGlobal("useRoute", () => ({ query: routeQuery }));

import ConfirmPage from "../../app/pages/comment-subscribe/confirm.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
};

function mountPage(query: Record<string, unknown> = {}) {
	routeQuery = query;
	return mount(ConfirmPage, { global: { stubs } });
}

describe("comment-subscribe confirm page", () => {
	beforeEach(() => {
		confirmGuestThreadSubscription.mockReset();
		setGuestThreadDigest.mockReset();
		setGuestThreadDigest.mockResolvedValue({ digest_weekly: true, updated: true });
	});

	it("shows the invalid-link message when no token is present", async () => {
		const wrapper = mountPage({});
		await flushPromises();
		expect(confirmGuestThreadSubscription).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("这个确认链接无效，或已经被使用过。");
	});

	it("posts the token once and shows success", async () => {
		confirmGuestThreadSubscription.mockResolvedValue({ confirmed: true, digest_weekly: false });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		expect(confirmGuestThreadSubscription).toHaveBeenCalledTimes(1);
		expect(confirmGuestThreadSubscription).toHaveBeenCalledWith("tok-123");
		expect(wrapper.text()).toContain("这篇讨论每当有新评论通过审核时，你都会收到一封邮件。");
	});

	it("seeds the weekly-summary checkbox from the confirm response", async () => {
		// A subscribe-time weekly opt-in must show checked, not the per-comment
		// default (DEC-429).
		confirmGuestThreadSubscription.mockResolvedValue({ confirmed: true, digest_weekly: true });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);
	});

	it("flips the cadence with the same token via the digest toggle", async () => {
		confirmGuestThreadSubscription.mockResolvedValue({ confirmed: true, digest_weekly: false });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		const checkbox = wrapper.find('input[type="checkbox"]');
		await checkbox.setValue(true);
		await flushPromises();

		expect(setGuestThreadDigest).toHaveBeenCalledTimes(1);
		expect(setGuestThreadDigest).toHaveBeenCalledWith("tok-123", true);
		expect(wrapper.text()).not.toContain("切换失败，请重试。");
	});

	it("shows a failure and snaps the checkbox back when the toggle errors", async () => {
		confirmGuestThreadSubscription.mockResolvedValue({ confirmed: true, digest_weekly: false });
		setGuestThreadDigest.mockRejectedValue(new Error("boom"));
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		await wrapper.find('input[type="checkbox"]').setValue(true);
		await flushPromises();

		expect(wrapper.text()).toContain("切换失败，请重试。");
		// The box snaps back to the server-known state (per-comment, unchecked).
		expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(
			false,
		);
	});

	it("shows the invalid state when the token is unknown/used (404)", async () => {
		confirmGuestThreadSubscription.mockRejectedValue({
			response: { status: 404 },
		});
		const wrapper = mountPage({ token: "tok-404" });
		await flushPromises();

		expect(confirmGuestThreadSubscription).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("这个确认链接无效，或已经被使用过。");
	});

	it("shows a network error (not 'invalid link') when the backend is unreachable", async () => {
		confirmGuestThreadSubscription.mockRejectedValue(
			new Error("FetchError: request to /api/posts/comment-subscription/guest/confirm failed"),
		);
		const wrapper = mountPage({ token: "tok-net" });
		await flushPromises();

		expect(confirmGuestThreadSubscription).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("网络错误，请稍后重试。");
		// Crucially NOT the "invalid/used" claim — the token may still be live.
		expect(wrapper.text()).not.toContain("这个确认链接无效，或已经被使用过。");
	});

	it("tells an unsubscribed address to re-subscribe instead of retry (400, round 408)", async () => {
		// The backend 400s a replayed confirm link on a deliberately
		// unsubscribed guest-thread address (consent-restart gate); before this
		// fix the page mislabeled it as a network error asking a dead-link
		// retry.
		confirmGuestThreadSubscription.mockRejectedValue({
			response: { status: 400 },
		});
		const wrapper = mountPage({ token: "tok-unsub" });
		await flushPromises();

		expect(confirmGuestThreadSubscription).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("该邮箱此前已退出该话题");
		expect(wrapper.text()).not.toContain("网络错误，请稍后重试。");
	});
});
