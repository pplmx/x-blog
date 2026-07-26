/**
 * 404 page tests
 * Tests the not-found page: renders the 404 title, message, and back links
 * (home and search). Stubs NuxtLink and Icon components.
 */

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import NotFoundPage from "../../app/pages/[...slug].vue";

function mountNotFoundPage() {
	return mount(NotFoundPage, {
		global: {
			stubs: {
				NuxtLink: {
					template: '<a :href="to"><slot/></a>',
					props: ["to"],
				},
				Icon: {
					template: '<svg class="iconstub" :data-icon="icon"></svg>',
					props: ["icon"],
				},
			},
		},
	});
}

describe("404 Page", () => {
	describe("Content", () => {
		it("renders the 404 title", () => {
			const wrapper = mountNotFoundPage();
			expect(wrapper.text()).toContain("404");
		});

		it("renders the page not found message", () => {
			const wrapper = mountNotFoundPage();
			expect(wrapper.text()).toContain("页面不存在");
		});

		it("renders the apology message", () => {
			const wrapper = mountNotFoundPage();
			expect(wrapper.text()).toContain("抱歉");
		});
	});

	describe("Navigation links", () => {
		it("renders a link to the home page", () => {
			const wrapper = mountNotFoundPage();
			const homeLink = wrapper.find('a[href="/"]');
			expect(homeLink.exists()).toBe(true);
			expect(homeLink.text()).toContain("返回首页");
		});

		it("renders a link to the search page", () => {
			const wrapper = mountNotFoundPage();
			const searchLink = wrapper.find('a[href="/search"]');
			expect(searchLink.exists()).toBe(true);
			expect(searchLink.text()).toContain("搜索");
		});
	});

	describe("Structure", () => {
		it("renders the container with min-h-screen class", () => {
			const wrapper = mountNotFoundPage();
			expect(wrapper.classes().some((c) => c.includes("min-h"))).toBe(true);
		});

		it("renders icons for navigation links", () => {
			const wrapper = mountNotFoundPage();
			const svgs = wrapper.findAll("svg");
			expect(svgs.length).toBeGreaterThanOrEqual(2);
		});
	});
});
