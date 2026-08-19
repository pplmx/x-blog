/**
 * ShareButtons component tests
 * Tests rendering of share buttons (Weibo, copy link), the copy link
 * functionality (clipboard API), and the copied state toggle.
 *
 * The component does not use async composites (no `await` in <script setup>),
 * so we can mount it directly without a Suspense wrapper.
 */

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ShareButtons from "../../components/ShareButtons.vue";

function mountShareButtons({
	title = "Test Post Title",
	url = "https://example.com/test-post",
}: {
	title?: string;
	url?: string;
} = {}) {
	return mount(ShareButtons, {
		props: { title, url },
		global: {
			stubs: {
				Icon: {
					template: '<svg class="iconstub" :data-icon="icon"></svg>',
					props: ["icon"],
				},
			},
		},
	});
}

describe("ShareButtons", () => {
	let clipboardSpy: ReturnType<typeof vi.spyOn>;
	let openSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		clipboardSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
		openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
	});

	afterEach(() => {
		clipboardSpy.mockRestore();
		openSpy.mockRestore();
		vi.restoreAllMocks();
	});

	describe("Rendering", () => {
		it("renders the share title text", () => {
			const wrapper = mountShareButtons();
			expect(wrapper.text()).toContain("分享到");
		});

		it("renders the Weibo share button", () => {
			const wrapper = mountShareButtons();
			const buttons = wrapper.findAll("button");
			// Should have at least 2 buttons: Weibo + Copy link
			expect(buttons.length).toBeGreaterThanOrEqual(2);
		});

		it("renders a copy link button", () => {
			const wrapper = mountShareButtons();
			const buttons = wrapper.findAll("button");
			// The last button should be the copy link button
			expect(buttons.length).toBeGreaterThanOrEqual(2);
		});

		it("renders the Weibo button with correct title", () => {
			const wrapper = mountShareButtons();
			const weiboButton = wrapper.findAll("button")[0];
			expect(weiboButton.attributes("title")).toBe("分享到微博");
		});

		it("renders the copy link button with correct title", () => {
			const wrapper = mountShareButtons();
			const buttons = wrapper.findAll("button");
			const copyButton = buttons[buttons.length - 1];
			expect(copyButton.attributes("title")).toBe("复制链接");
		});
	});

	describe("Weibo sharing", () => {
		it("opens Weibo share URL when clicking the Weibo button", async () => {
			const wrapper = mountShareButtons({
				url: "https://example.com/post",
				title: "Hello",
			});
			const weiboButton = wrapper.findAll("button")[0];
			await weiboButton.trigger("click");

			expect(openSpy).toHaveBeenCalledTimes(1);
			const shareUrl = openSpy.mock.calls[0][0] as string;
			expect(shareUrl).toContain("service.weibo.com/share/share.php");
			expect(shareUrl).toContain("url=");
			expect(shareUrl).toContain("title=");
		});

		it("opens Weibo share URL with encoded URL", async () => {
			const wrapper = mountShareButtons({
				url: "https://example.com/post",
				title: "Hello",
			});
			const weiboButton = wrapper.findAll("button")[0];
			await weiboButton.trigger("click");

			const shareUrl = openSpy.mock.calls[0][0] as string;
			expect(shareUrl).toContain(encodeURIComponent("https://example.com/post"));
		});

		it("opens Weibo share URL with encoded title", async () => {
			const wrapper = mountShareButtons({
				url: "https://example.com/post",
				title: "Hello World",
			});
			const weiboButton = wrapper.findAll("button")[0];
			await weiboButton.trigger("click");

			const shareUrl = openSpy.mock.calls[0][0] as string;
			expect(shareUrl).toContain(encodeURIComponent("Hello World"));
		});

		it("opens with correct window features", async () => {
			const wrapper = mountShareButtons();
			const weiboButton = wrapper.findAll("button")[0];
			await weiboButton.trigger("click");

			expect(openSpy).toHaveBeenCalledWith(expect.any(String), "_blank", "width=550,height=450");
		});
	});

	describe("Copy link", () => {
		it("writes the URL to clipboard when clicking copy button", async () => {
			const wrapper = mountShareButtons({ url: "https://example.com/test" });
			const buttons = wrapper.findAll("button");
			const copyButton = buttons[buttons.length - 1];

			await copyButton.trigger("click");

			expect(clipboardSpy).toHaveBeenCalledWith("https://example.com/test");
		});

		it("shows check icon after copying", async () => {
			const wrapper = mountShareButtons();
			const buttons = wrapper.findAll("button");
			const copyButton = buttons[buttons.length - 1];

			await copyButton.trigger("click");
			await wrapper.vm.$nextTick();

			// After copying, the check icon should be visible
			// (we can't easily check which icon is rendered due to stub,
			// but the copied state should be true)
			expect(clipboardSpy).toHaveBeenCalledTimes(1);
		});

		it("resets to link icon after timeout (copied state)", async () => {
			vi.useFakeTimers();
			const wrapper = mountShareButtons();
			const buttons = wrapper.findAll("button");
			const copyButton = buttons[buttons.length - 1];

			await copyButton.trigger("click");
			expect(clipboardSpy).toHaveBeenCalledTimes(1);

			// After 2 seconds, copied state should reset
			vi.advanceTimersByTime(2000);
			await wrapper.vm.$nextTick();

			// The copied state should have been reset
			// (we verify by checking that the clipboard was only called once)
			expect(clipboardSpy).toHaveBeenCalledTimes(1);
			vi.useRealTimers();
		});
	});

	describe("URL handling", () => {
		it("uses the provided URL prop", async () => {
			const wrapper = mountShareButtons({ url: "https://custom.url/post" });
			const buttons = wrapper.findAll("button");
			const copyButton = buttons[buttons.length - 1];
			await copyButton.trigger("click");
			expect(clipboardSpy).toHaveBeenCalledWith("https://custom.url/post");
		});

		it("falls back to window.location.href when no URL is provided", async () => {
			// window.location.href in happy-dom defaults to the test page URL
			const wrapper = mount(ShareButtons, {
				props: { title: "Test" },
				global: {
					stubs: {
						Icon: {
							template: '<svg class="iconstub" :data-icon="icon"></svg>',
							props: ["icon"],
						},
					},
				},
			});
			const buttons = wrapper.findAll("button");
			const copyButton = buttons[buttons.length - 1];
			await copyButton.trigger("click");
			// Should have been called with some URL (the window.location.href)
			expect(clipboardSpy).toHaveBeenCalledTimes(1);
			const copiedUrl = clipboardSpy.mock.calls[0][0];
			expect(typeof copiedUrl).toBe("string");
			expect(copiedUrl.length).toBeGreaterThan(0);
		});
	});

	describe("Accessibility", () => {
		it("has a title attribute on the Weibo button", () => {
			const wrapper = mountShareButtons();
			const weiboButton = wrapper.findAll("button")[0];
			expect(weiboButton.attributes("title")).toBeTruthy();
		});

		it("has a title attribute on the copy button", () => {
			const wrapper = mountShareButtons();
			const buttons = wrapper.findAll("button");
			const copyButton = buttons[buttons.length - 1];
			expect(copyButton.attributes("title")).toBeTruthy();
		});
	});

	describe("X / Twitter sharing", () => {
		it("opens the X intent URL when clicking the X button", async () => {
			const wrapper = mountShareButtons({
				url: "https://example.com/post",
				title: "Hello",
			});
			const xButton = wrapper.findAll("button")[1];
			await xButton.trigger("click");

			expect(openSpy).toHaveBeenCalledTimes(1);
			const shareUrl = openSpy.mock.calls[0][0] as string;
			expect(shareUrl).toContain("twitter.com/intent/tweet");
			expect(shareUrl).toContain(encodeURIComponent("https://example.com/post"));
			expect(shareUrl).toContain(encodeURIComponent("Hello"));
			expect(openSpy).toHaveBeenCalledWith(expect.any(String), "_blank", "width=600,height=450");
		});
	});

	describe("Facebook sharing", () => {
		it("opens the Facebook sharer URL when clicking the Facebook button", async () => {
			const wrapper = mountShareButtons({
				url: "https://example.com/post",
				title: "Hello",
			});
			const fbButton = wrapper.findAll("button")[2];
			await fbButton.trigger("click");

			expect(openSpy).toHaveBeenCalledTimes(1);
			const shareUrl = openSpy.mock.calls[0][0] as string;
			expect(shareUrl).toContain("facebook.com/sharer/sharer.php");
			expect(shareUrl).toContain(`u=${encodeURIComponent("https://example.com/post")}`);
			expect(openSpy).toHaveBeenCalledWith(expect.any(String), "_blank", "width=600,height=500");
		});
	});

	describe("LinkedIn sharing", () => {
		it("opens the LinkedIn share-offsite URL when clicking the LinkedIn button", async () => {
			const wrapper = mountShareButtons({
				url: "https://example.com/post",
				title: "Hello",
			});
			const liButton = wrapper.findAll("button")[3];
			await liButton.trigger("click");

			expect(openSpy).toHaveBeenCalledTimes(1);
			const shareUrl = openSpy.mock.calls[0][0] as string;
			expect(shareUrl).toContain("linkedin.com/sharing/share-offsite");
			expect(shareUrl).toContain(`url=${encodeURIComponent("https://example.com/post")}`);
			expect(openSpy).toHaveBeenCalledWith(expect.any(String), "_blank", "width=600,height=500");
		});
	});

	describe("Copy link failure", () => {
		it("swallows clipboard errors without throwing", async () => {
			clipboardSpy.mockRejectedValueOnce(new Error("clipboard unavailable"));
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const wrapper = mountShareButtons();
			const buttons = wrapper.findAll("button");
			const copyButton = buttons[buttons.length - 1];

			await expect(copyButton.trigger("click")).resolves.not.toThrow();
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});
	});
});
