/**
 * LanguageSwitcher component tests
 * Tests rendering, locale display, and switching behavior.
 */

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LanguageSwitcher from "../../components/LanguageSwitcher.vue";

describe("LanguageSwitcher", () => {
	let mockNavigateTo: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.stubGlobal("useCookie", (_name: string) => ({
			value: "zh-CN",
		}));

		vi.stubGlobal("useRoute", () => ({
			path: "/posts",
			query: {},
			params: {},
		}));

		mockNavigateTo = vi.fn();
		vi.stubGlobal("navigateTo", mockNavigateTo);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("rendering", () => {
		it("renders without errors", () => {
			const wrapper = mount(LanguageSwitcher);
			expect(wrapper.exists()).toBe(true);
		});

		it("renders a select element", () => {
			const wrapper = mount(LanguageSwitcher);
			expect(wrapper.find("select").exists()).toBe(true);
		});

		it("renders locale names as options", () => {
			const wrapper = mount(LanguageSwitcher);
			const options = wrapper.findAll("option");
			expect(options.length).toBe(3);
			expect(options[2].text()).toBe("繁體中文");
			expect(options[0].text()).toBe("中文");
			expect(options[1].text()).toBe("English");
		});

		it("has aria-label for accessibility", () => {
			const wrapper = mount(LanguageSwitcher);
			expect(wrapper.find("select").attributes("aria-label")).toBe("Switch language");
		});

		it("renders a chevron-down icon", () => {
			const wrapper = mount(LanguageSwitcher);
			const icon = wrapper.findComponent({ name: "Icon" });
			// Icon is rendered via the Icon component
			expect(wrapper.find(".pointer-events-none").exists()).toBe(true);
		});
	});

	describe("locale switching", () => {
		it("calls navigateTo when locale changes", async () => {
			const wrapper = mount(LanguageSwitcher);
			const select = wrapper.find("select");
			await select.setValue("en");
			expect(mockNavigateTo).toHaveBeenCalled();
		});
	});
});
