/**
 * PagesFooterLinks component tests (round 347).
 *
 * The footer's published-page link list: renders a link per published page,
 * and renders nothing (not an error state) when the site has none / the fetch
 * failed — the pages stay reachable by URL either way.
 *
 * The component uses `await usePages()` in <script setup>, so it is mounted
 * inside a <Suspense> boundary.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

async function mountLinks({ pages = null }: { pages?: unknown } = {}) {
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "http://localhost:18888" },
	}));
	vi.stubGlobal("useHead", vi.fn());
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string | (() => string | null) | { value: string }) => {
			const urlStr =
				typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
			if (typeof urlStr === "string" && urlStr === "/api/pages") {
				return { data: ref(pages), pending: ref(false), error: ref(null), refresh: vi.fn() };
			}
			return {
				data: ref(null),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			};
		}),
	);

	const { default: FooterLinks } = await import("../../components/PagesFooterLinks.vue");
	const SuspenseWrapper = {
		components: { FooterLinks },
		template:
			"<Suspense>" +
			"<template #default><FooterLinks /></template>" +
			"<template #fallback></template>" +
			"</Suspense>",
	};

	const wrapper = mount(SuspenseWrapper, {
		global: {
			stubs: {
				NuxtLink: { template: '<a :href="to"><slot/></a>', props: ["to"] },
				Icon: { template: '<svg class="iconstub" :data-icon="icon"></svg>', props: ["icon"] },
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe("PagesFooterLinks", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders a link per published page", async () => {
		const wrapper = await mountLinks({
			pages: [{ slug: "privacy", title: "Privacy Policy" }],
		});
		expect(wrapper.text()).toContain("Privacy Policy");
		const link = wrapper.find('a[href="/pages/privacy"]');
		expect(link.exists()).toBe(true);
	});

	it("renders nothing when there are no published pages", async () => {
		const wrapper = await mountLinks({ pages: [] });
		expect(wrapper.text()).toBe("");
	});
});
