/**
 * ReaderAvatar component tests (round-446).
 *
 * The shared reader/writer profile picture with graceful degradation: renders
 * the uploaded <img> when a URL is set, the initial-letter glyph when it is
 * not, and — the gap the old per-site copies shared — swaps to the letter
 * when the img fails to load (a file deleted server-side must not leave a
 * broken-image icon).
 */

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ReaderAvatar from "../../components/ReaderAvatar.vue";

function mountAvatar(props: Record<string, unknown>) {
	return mount(ReaderAvatar, { props });
}

describe("ReaderAvatar", () => {
	it("renders the uploaded image when a URL is set", () => {
		const wrapper = mountAvatar({ url: "/static/avatars/riki.png", name: "Riki" });
		const img = wrapper.find("img");
		expect(img.exists()).toBe(true);
		expect(img.attributes("src")).toBe("/static/avatars/riki.png");
	});

	it("renders the initial-letter placeholder when no URL is set", () => {
		const wrapper = mountAvatar({ url: null, name: "Riki" });
		expect(wrapper.find("img").exists()).toBe(false);
		expect(wrapper.text()).toContain("R");
	});

	it("falls back to an unnamed reader's letter", () => {
		const wrapper = mountAvatar({ url: null, name: null });
		expect(wrapper.text()).toContain("R");
	});

	it("swaps to the letter when the image fails to load (file gone)", async () => {
		const wrapper = mountAvatar({ url: "/static/avatars/gone.png", name: "Riki" });
		expect(wrapper.find("img").exists()).toBe(true);
		// Simulate the browser's load failure — the @error handler hides the
		// img and shows the letter instead of a broken-image icon.
		await wrapper.find("img").trigger("error");
		expect(wrapper.find("img").exists()).toBe(false);
		expect(wrapper.text()).toContain("R");
	});

	it("applies size classes to both the image and the letter", () => {
		const withImg = mountAvatar({ url: "/s.png", name: "Riki", size: "w-16 h-16" });
		expect(withImg.find("img").classes()).toContain("w-16");
		const withLetter = mountAvatar({ url: null, name: "Riki", size: "w-16 h-16" });
		expect(withLetter.find("span").classes()).toContain("h-16");
	});
});
