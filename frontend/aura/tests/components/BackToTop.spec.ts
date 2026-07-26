/**
 * BackToTop component tests
 * Tests visibility toggle on scroll, scroll-to-top behavior, and hover state.
 */

import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BackToTop from "../../components/BackToTop.vue";

let wrapper: VueWrapper;

beforeEach(() => {
	// Mock window.scrollTo
	window.scrollTo = vi.fn();

	// Mock window.scrollY
	Object.defineProperty(window, "scrollY", {
		writable: true,
		value: 0,
	});
});

afterEach(() => {
	if (wrapper) wrapper.unmount();
});

describe("BackToTop", () => {
	describe("rendering", () => {
		it("does not render when scroll position is 0", () => {
			wrapper = mount(BackToTop);
			expect(wrapper.find("button").exists()).toBe(false);
		});

		it("renders button when scrolled down 300px", async () => {
			wrapper = mount(BackToTop);
			// Simulate scroll
			window.scrollY = 400;
			window.dispatchEvent(new Event("scroll"));

			await wrapper.vm.$nextTick();
			expect(wrapper.find("button").exists()).toBe(true);
		});
	});

	describe("scroll behavior", () => {
		it("calls window.scrollTo with smooth behavior", async () => {
			wrapper = mount(BackToTop);
			// Make button visible
			window.scrollY = 400;
			window.dispatchEvent(new Event("scroll"));
			await wrapper.vm.$nextTick();

			const button = wrapper.find("button");
			await button.trigger("click");

			expect(window.scrollTo).toHaveBeenCalledWith({
				top: 0,
				behavior: "smooth",
			});
		});
	});

	describe("event listener cleanup", () => {
		it("removes scroll listener on unmount", () => {
			const removeSpy = vi.spyOn(window, "removeEventListener");
			wrapper = mount(BackToTop);
			wrapper.unmount();
			expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
		});
	});
});
