/**
 * Default layout tests
 * Tests the navigation header, footer, and slot rendering.
 * Stubs NuxtLink and Icon components (same pattern as about.spec.ts).
 */
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import DefaultLayout from "../../app/layouts/default.vue";

function mountLayout() {
  return mount(DefaultLayout, {
    slots: {
      default: '<div class="page-content">Page content here</div>',
    },
    global: {
      stubs: {
        NuxtLink: {
          template: '<a :href="to"><slot/></a>',
          props: ["to"],
        },
        Icon: {
          template: '<svg class="iconstub" data-icon=":icon"></svg>',
          props: ["icon"],
        },
      },
    },
  });
}

describe("Default Layout", () => {
  describe("Header", () => {
    it("renders the X-Blog brand name", () => {
      const wrapper = mountLayout();
      expect(wrapper.text()).toContain("X-Blog");
    });

    it("renders a navigation section", () => {
      const wrapper = mountLayout();
      const nav = wrapper.find("nav");
      expect(nav.exists()).toBe(true);
    });

    it("renders a link to the home page in the nav", () => {
      const wrapper = mountLayout();
      const homeLinks = wrapper.findAll('a[href="/"]');
      // First link is the brand "X-Blog", second is the nav "首页"
      const navHomeLink = homeLinks.find((a) => a.text().includes("首页"));
      expect(navHomeLink).toBeDefined();
    });

    it("renders a link to the about page", () => {
      const wrapper = mountLayout();
      const aboutLink = wrapper.find('a[href="/about"]');
      expect(aboutLink.exists()).toBe(true);
      expect(aboutLink.text()).toContain("关于");
    });

    it("renders home and about links within the same nav", () => {
      const wrapper = mountLayout();
      const nav = wrapper.find("nav");
      const links = nav.findAll("a");
      // Should have at least 2 links (home + about) plus the brand link
      const navLinks = links.filter((a) => a.attributes("href") === "/" || a.attributes("href") === "/about");
      expect(navLinks.length).toBe(2);
    });
  });

  describe("Slot", () => {
    it("renders slot content in the main area", () => {
      const wrapper = mountLayout();
      expect(wrapper.text()).toContain("Page content here");
      const mainContent = wrapper.find(".page-content");
      expect(mainContent.exists()).toBe(true);
    });

    it("renders the main element", () => {
      const wrapper = mountLayout();
      expect(wrapper.find("main").exists()).toBe(true);
    });
  });

  describe("Footer", () => {
    it("renders the footer", () => {
      const wrapper = mountLayout();
      expect(wrapper.find("footer").exists()).toBe(true);
    });

    it("renders the 'Made with' text", () => {
      const wrapper = mountLayout();
      expect(wrapper.text()).toMatch(/Made with/);
    });

    it("renders the 'for developers' text", () => {
      const wrapper = mountLayout();
      expect(wrapper.text()).toMatch(/for developers/);
    });
  });

  describe("Structure", () => {
    it("renders as a flex column container", () => {
      const wrapper = mountLayout();
      const root = wrapper.element;
      // The root div should have min-h-screen and flex flex-col
      expect(root.classList.contains("min-h-screen")).toBe(true);
      expect(root.classList.contains("flex")).toBe(true);
      expect(root.classList.contains("flex-col")).toBe(true);
    });

    it("renders header, main, and footer elements", () => {
      const wrapper = mountLayout();
      expect(wrapper.find("header").exists()).toBe(true);
      expect(wrapper.find("main").exists()).toBe(true);
      expect(wrapper.find("footer").exists()).toBe(true);
    });
  });
});
