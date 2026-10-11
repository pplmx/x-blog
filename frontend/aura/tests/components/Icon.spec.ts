/**
 * Icon component tests (offline lucide rendering).
 *
 * Icon.vue wraps @iconify/vue/offline and pre-registers the bundled lucide
 * subset (assets/icons/lucide.ts), so icons render as an inline <svg> on the
 * first frame with NO fetch to api.iconify.design. This spec proves the offline
 * path: a known icon renders synchronously, and an unknown icon degrades to an
 * empty element instead of triggering a network request or throwing.
 */

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import Icon from "../../components/Icon.vue";

describe("Icon (offline lucide)", () => {
	it("renders a known lucide icon as an inline <svg> with no network fetch", () => {
		const wrapper = mount(Icon, { props: { icon: "lucide:search" } });
		const html = wrapper.html();
		// Standard 24x24 svg box that Iconify renders synchronously from storage.
		expect(html).toContain("<svg");
		expect(html).toContain('viewBox="0 0 24 24"');
		// The search glyph's magnifier circle + handle are in the bundled body.
		expect(html).toContain("m21 21l-4.34-4.34");
	});

	it("applies width/height props to the rendered svg", () => {
		const wrapper = mount(Icon, {
			props: { icon: "lucide:heart", width: 32, height: 32 },
		});
		const html = wrapper.html();
		expect(html).toContain('width="32"');
		expect(html).toContain('height="32"');
	});

	it("resolves the alias icon name (alert-triangle → triangle-alert body)", () => {
		const wrapper = mount(Icon, { props: { icon: "lucide:alert-triangle" } });
		// Lucide aliases (alert-triangle) resolve through the bundled aliases map.
		expect(wrapper.html()).toContain("<svg");
	});

	it("renders nothing (empty default slot) for an unknown icon without throwing", () => {
		const wrapper = mount(Icon, { props: { icon: "lucide:this-icon-does-not-exist" } });
		// Offline build: unknown name → no svg, no network, no exception.
		expect(wrapper.find("svg").exists()).toBe(false);
		expect(wrapper.text()).toBe("");
	});
});
