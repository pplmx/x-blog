/**
 * About page tests
 * Tests the static about page content (Vue/Nuxt migration of page.test.tsx)
 */
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import AboutPage from "../../app/pages/about.vue";

function mountAboutPage() {
  return mount(AboutPage, {
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

describe("About Page", () => {
  describe("Static rendering", () => {
    it("renders the about page header", () => {
      const wrapper = mountAboutPage();
      expect(wrapper.text()).toContain("关于 X-Blog");
    });

    it("renders the description text", () => {
      const wrapper = mountAboutPage();
      expect(wrapper.text()).toMatch(/一个现代化的技术博客系统/);
    });

    it("renders the back to home link", () => {
      const wrapper = mountAboutPage();
      expect(wrapper.text()).toMatch(/返回首页/);
      // NuxtLink stub renders as <a :href="to">
      const link = wrapper.find('a[href="/"]');
      expect(link.exists()).toBe(true);
    });
  });

  describe("Tech stack section", () => {
    it("renders all tech stack items", () => {
      const wrapper = mountAboutPage();
      const text = wrapper.text();
      expect(text).toContain("Nuxt");
      expect(text).toContain("FastAPI");
      expect(text).toContain("SQLAlchemy");
      expect(text).toContain("TypeScript");
    });

    it("renders tech stack descriptions", () => {
      const wrapper = mountAboutPage();
      const text = wrapper.text();
      expect(text).toContain("前端框架");
      expect(text).toContain("后端框架");
      expect(text).toContain("ORM");
      expect(text).toContain("语言");
    });

    it("renders tech stack section header", () => {
      const wrapper = mountAboutPage();
      expect(wrapper.text()).toContain("技术栈");
    });
  });

  describe("Features section", () => {
    it("renders all feature items", () => {
      const wrapper = mountAboutPage();
      const text = wrapper.text();
      expect(text).toContain("Markdown 文章支持");
      expect(text).toContain("分类与标签管理");
      expect(text).toContain("评论系统");
      expect(text).toContain("阅读量统计");
      expect(text).toContain("RSS 订阅");
      expect(text).toContain("SEO 优化");
      expect(text).toContain("响应式设计");
      expect(text).toContain("管理后台");
    });

    it("renders features section header", () => {
      const wrapper = mountAboutPage();
      expect(wrapper.text()).toContain("核心功能");
    });
  });

  describe("Footer", () => {
    it("renders the made with text", () => {
      const wrapper = mountAboutPage();
      expect(wrapper.text()).toMatch(/for developers/);
    });
  });
});
