/**
 * App root component tests
 * Tests the root app.vue: renders NuxtLayout with NuxtPage inside.
 * Stubs NuxtLayout and NuxtPage components.
 */
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import App from "../app/app.vue";

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

  describe("Structure", () => {
    it("renders layout wrapping page content", () => {
      const wrapper = mountApp();
      const layout = wrapper.find(".nuxt-layout");
      const page = wrapper.find(".nuxt-page");
      expect(layout.exists()).toBe(true);
      expect(page.exists()).toBe(true);
      // Page should be inside layout
      expect(layout.element.contains(page.element)).toBe(true);
    });
  });
});
