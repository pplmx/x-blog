/**
 * Skeleton component tests
 * Tests rendering of all skeleton types: post-list, post-detail, sidebar, page.
 */
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import Skeleton from "../../components/Skeleton.vue";

describe("Skeleton", () => {
  describe("type: post-list", () => {
    it("renders without errors", () => {
      const wrapper = mount(Skeleton, { props: { type: "post-list" } });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders 5 placeholder items", () => {
      const wrapper = mount(Skeleton, { props: { type: "post-list" } });
      // Each post has a bg-white container
      const items = wrapper.findAll(".bg-white, .dark\\:bg-gray-900");
      expect(items.length).toBeGreaterThanOrEqual(5);
    });

    it("contains animate-pulse elements", () => {
      const wrapper = mount(Skeleton, { props: { type: "post-list" } });
      expect(wrapper.find(".animate-pulse").exists()).toBe(true);
    });
  });

  describe("type: post-detail", () => {
    it("renders without errors", () => {
      const wrapper = mount(Skeleton, { props: { type: "post-detail" } });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders an article element", () => {
      const wrapper = mount(Skeleton, { props: { type: "post-detail" } });
      expect(wrapper.find("article").exists()).toBe(true);
    });

    it("renders a cover image placeholder", () => {
      const wrapper = mount(Skeleton, { props: { type: "post-detail" } });
      expect(wrapper.find(".h-64").exists()).toBe(true);
    });
  });

  describe("type: sidebar", () => {
    it("renders without errors", () => {
      const wrapper = mount(Skeleton, { props: { type: "sidebar" } });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders an aside element", () => {
      const wrapper = mount(Skeleton, { props: { type: "sidebar" } });
      expect(wrapper.find("aside").exists()).toBe(true);
    });
  });

  describe("type: page", () => {
    it("renders without errors", () => {
      const wrapper = mount(Skeleton, { props: { type: "page" } });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders a flex layout for page skeleton", () => {
      const wrapper = mount(Skeleton, { props: { type: "page" } });
      expect(wrapper.find(".flex-col").exists()).toBe(true);
    });
  });

  describe("default type", () => {
    it("renders post-list when type is not specified", () => {
      const wrapper = mount(Skeleton);
      expect(wrapper.find(".space-y-8").exists()).toBe(true);
    });
  });
});
