/**
 * Icon component tests
 * Tests the Icon wrapper around @iconify/vue — prop passthrough,
 * width/height/class forwarding, and the console.warn error path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";

import Icon from "../../components/Icon.vue";

describe("Icon", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("rendering", () => {
    it("renders an icon with the provided icon prop", () => {
      const wrapper = mount(Icon, {
        props: { icon: "lucide:home" },
      });
      const svg = wrapper.find("svg");
      expect(svg.exists()).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("renders without errors when all optional props are omitted", () => {
      const wrapper = mount(Icon, {
        props: { icon: "lucide:sparkles" },
      });
      expect(wrapper.find("svg").exists()).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("prop passthrough", () => {
    it("passes the class prop to the rendered svg", () => {
      const wrapper = mount(Icon, {
        props: { icon: "lucide:arrow-left", class: "w-4 h-4 text-blue-600" },
      });
      const svg = wrapper.find("svg");
      expect(svg.classes()).toContain("w-4");
      expect(svg.classes()).toContain("h-4");
      expect(svg.classes()).toContain("text-blue-600");
    });

    it("passes width and height props to the rendered svg", () => {
      const wrapper = mount(Icon, {
        props: { icon: "lucide:home", width: 24, height: 24 },
      });
      const svg = wrapper.find("svg");
      expect(svg.attributes("width")).toBe("24");
      expect(svg.attributes("height")).toBe("24");
    });

    it("passes string width and height props", () => {
      const wrapper = mount(Icon, {
        props: { icon: "lucide:home", width: "32", height: "32" },
      });
      const svg = wrapper.find("svg");
      expect(svg.attributes("width")).toBe("32");
      expect(svg.attributes("height")).toBe("32");
    });

    it("renders correctly with only class prop (no width/height)", () => {
      const wrapper = mount(Icon, {
        props: { icon: "lucide:heart", class: "w-4 h-4 text-red-500" },
      });
      const svg = wrapper.find("svg");
      expect(svg.exists()).toBe(true);
      expect(svg.classes()).toContain("text-red-500");
    });
  });

  describe("error handling", () => {
    it("warns when the icon prop is missing", () => {
      // Suppress the expected warning to avoid noise
      mount(Icon, {
        props: { icon: "" },
      });
      expect(warnSpy).toHaveBeenCalledWith("[Icon] Missing icon prop");
    });

    it("warns when the icon prop is undefined", () => {
      mount(Icon, {
        props: {},
      });
      expect(warnSpy).toHaveBeenCalledWith("[Icon] Missing icon prop");
    });
  });

  describe("icon prop variations", () => {
    it("renders with a simple icon name", () => {
      const wrapper = mount(Icon, { props: { icon: "lucide:home" } });
      expect(wrapper.find("svg").exists()).toBe(true);
    });

    it("renders with an icon name containing a colon", () => {
      const wrapper = mount(Icon, { props: { icon: "mdi:account" } });
      expect(wrapper.find("svg").exists()).toBe(true);
    });
  });
});
