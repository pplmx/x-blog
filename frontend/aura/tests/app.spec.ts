/**
 * App root component tests
 * Tests the root app.vue: renders NuxtLayout with NuxtPage inside.
 * Stubs NuxtLayout and NuxtPage components.
 */

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../app/app.vue";

// app.vue syncs <html lang> via useHead; stub it so mounting doesn't throw.
beforeEach(() => {
	vi.stubGlobal("useHead", vi.fn());
	// app.vue resolves the site-default og/WebSite tags from the runtime site
	// URL (TASK-557) — pin a deterministic value for the assertion below.
	vi.stubGlobal("useRuntimeConfig", () => ({ public: { siteUrl: "https://share.test" } }));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function mountApp() {
	return mount(App, {
		global: {
			stubs: {
				NuxtLayout: {
					template: '<div class="nuxt-layout"><slot/></div>',
				},
				NuxtPage: {
					template: '<div class="nuxt-page">Page content</div>',
				},
			},
		},
	});
}

describe("App Root", () => {
	describe("Rendering", () => {
		it("renders without errors", () => {
			const wrapper = mountApp();
			expect(wrapper.exists()).toBe(true);
		});

		it("renders the NuxtLayout wrapper", () => {
			const wrapper = mountApp();
			expect(wrapper.find(".nuxt-layout").exists()).toBe(true);
		});

		it("renders the NuxtPage inside the layout", () => {
			const wrapper = mountApp();
			expect(wrapper.find(".nuxt-page").exists()).toBe(true);
			expect(wrapper.text()).toContain("Page content");
		});
	});

	describe("Feed auto-discovery", () => {
		it("emits RSS and Atom alternate link tags via useHead", () => {
			mountApp();
			const calls = vi.mocked(useHead).mock.calls;
			const linkArgs = calls.flatMap(([arg]) =>
				arg && Array.isArray((arg as Record<string, unknown>).link)
					? ((arg as Record<string, unknown>).link as Array<Record<string, string>>)
					: [],
			);
			const rss = linkArgs.find((l) => l.href === "/rss/feed.xml");
			const atom = linkArgs.find((l) => l.href === "/rss/atom.xml");
			expect(rss).toBeTruthy();
			expect(rss?.type).toBe("application/rss+xml");
			expect(rss?.rel).toBe("alternate");
			expect(atom).toBeTruthy();
			expect(atom?.type).toBe("application/atom+xml");
		});
	});

	describe("Site-default URL-dependent head (TASK-557)", () => {
		it("resolves og:url / og:image / twitter:image and WebSite JSON-LD from the runtime site URL", () => {
			mountApp();
			// The site-default head is built from a siteUrl resolved EAGERLY in
			// app.vue setup (useHead args must not call useRuntimeConfig — unhead
			// resolves them outside the Nuxt context), so the useHead argument is
			// a plain object; find it by its URL-dependent meta.
			const calls = vi.mocked(useHead).mock.calls;
			const resolved = calls
				.map(([arg]) => arg as Record<string, unknown> | undefined)
				.find(
					(arg) =>
						arg &&
						Array.isArray(arg.meta) &&
						(arg.meta as Array<Record<string, string>>).some((m) => m.property === "og:url"),
				) as {
				meta: Array<Record<string, string>>;
				script?: Array<Record<string, unknown>>;
			};
			expect(resolved).toBeTruthy();
			expect(resolved.meta.find((m) => m.property === "og:url")?.content).toBe(
				"https://share.test",
			);
			// The og image resolves siteConfig.image against the runtime site URL.
			expect(resolved.meta.find((m) => m.property === "og:image")?.content).toBe(
				"https://share.test/api/og?title=X-Blog",
			);
			expect(resolved.meta.find((m) => m.name === "twitter:image")?.content).toBe(
				"https://share.test/api/og?title=X-Blog",
			);
			const ldScript = resolved.script?.find((s) => s.type === "application/ld+json");
			expect(ldScript).toBeTruthy();
			const parsed = JSON.parse(
				String((ldScript as Record<string, unknown>).textContent),
			) as Record<string, unknown>;
			expect(parsed["@type"]).toBe("WebSite");
			expect(parsed.name).toBe("X-Blog");
			expect(parsed.url).toBe("https://share.test");
		});

		it("falls back to the default localhost site URL when runtime config is empty", () => {
			vi.stubGlobal("useRuntimeConfig", () => ({ public: { siteUrl: "" } }));
			mountApp();
			const calls = vi.mocked(useHead).mock.calls;
			const resolved = calls
				.map(([arg]) => arg as Record<string, unknown> | undefined)
				.find(
					(arg) =>
						arg &&
						Array.isArray(arg.meta) &&
						(arg.meta as Array<Record<string, string>>).some((m) => m.property === "og:url"),
				) as { meta: Array<Record<string, string>> };
			expect(resolved.meta.find((m) => m.property === "og:url")?.content).toBe(
				"http://localhost:3000",
			);
		});
	});
});
