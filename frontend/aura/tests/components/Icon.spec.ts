import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@iconify/vue", () => ({
	Icon: {
		name: "Icon",
		template: '<svg :data-icon="icon" :width="width" :height="height" v-bind="$attrs"></svg>',
		props: ["icon", "width", "height"],
	},
}));

async function loadIcon() {
	const { default: IconComponent } = await import("../../components/Icon.vue");
	return IconComponent;
}

describe("Icon", () => {
	describe("rendering", () => {
		it("renders an svg element", async () => {
			const Icon = await loadIcon();
			const wrapper = mount(Icon, { props: { icon: "lucide:home" } });
			expect(wrapper.find("svg").exists()).toBe(true);
		});

		it("sets the data-icon attribute", async () => {
			const Icon = await loadIcon();
			const wrapper = mount(Icon, { props: { icon: "lucide:home" } });
			const svg = wrapper.find("svg");
			expect(svg.attributes("data-icon")).toBe("lucide:home");
		});

		it("applies custom width and height", async () => {
			const Icon = await loadIcon();
			const wrapper = mount(Icon, { props: { icon: "lucide:home", width: 32, height: 32 } });
			const svg = wrapper.find("svg");
			expect(svg.attributes("width")).toBe("32");
			expect(svg.attributes("height")).toBe("32");
		});

		it("applies custom class", async () => {
			const Icon = await loadIcon();
			const wrapper = mount(Icon, { props: { icon: "lucide:home", class: "text-red-500" } });
			const svg = wrapper.find("svg");
			expect(svg.exists()).toBe(true);
			expect(svg.classes()).toContain("text-red-500");
		});
	});

	describe("icon prop variations", () => {
		it("renders with a simple icon name", async () => {
			const Icon = await loadIcon();
			const wrapper = mount(Icon, { props: { icon: "lucide:home" } });
			expect(wrapper.find("svg").exists()).toBe(true);
		});

		it("renders with an icon name containing a colon", async () => {
			const Icon = await loadIcon();
			const wrapper = mount(Icon, { props: { icon: "mdi:account" } });
			expect(wrapper.find("svg").exists()).toBe(true);
		});
	});
});
