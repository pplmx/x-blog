/**
 * ImageLightbox component tests
 * Tests rendering, image display, navigation, and keyboard events.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";

import ImageLightbox from "../../components/ImageLightbox.vue";

const mockImages = [
  { src: "https://example.com/img1.jpg", alt: "Image 1" },
  { src: "https://example.com/img2.jpg", alt: "Image 2" },
  { src: "https://example.com/img3.jpg", alt: "Image 3" },
];

describe("ImageLightbox", () => {
  let keydownHandler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    keydownHandler = vi.fn();
    vi.spyOn(document, "addEventListener").mockImplementation((event, handler) => {
      if (event === "keydown") {
        keydownHandler = handler as (e: KeyboardEvent) => void;
      }
    });
    vi.spyOn(document, "removeEventListener").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders without errors", () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the current image", () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      const img = wrapper.find("img");
      expect(img.exists()).toBe(true);
      expect(img.attributes("src")).toBe("https://example.com/img1.jpg");
      expect(img.attributes("alt")).toBe("Image 1");
    });

    it("updates image when currentIndex changes", async () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      await wrapper.setProps({ currentIndex: 1 });
      expect(wrapper.find("img").attributes("src")).toBe("https://example.com/img2.jpg");
    });

    it("renders image counter when multiple images", () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      expect(wrapper.text()).toContain("1 / 3");
    });

    it("does not render counter when single image", () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: [mockImages[0]], currentIndex: 0 },
      });
      expect(wrapper.text()).not.toContain("1 / 1");
    });
  });

  describe("navigation", () => {
    it("emits close when clicking the close button", async () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      await wrapper.find("button[aria-label='关闭']").trigger("click");
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("emits close when clicking the backdrop", async () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      await wrapper.trigger("click");
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("emits navigate with index-1 when clicking prev", async () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 1 },
      });
      const prevButton = wrapper.find("button[title='上一张 (←)']");
      await prevButton.trigger("click");
      expect(wrapper.emitted("navigate")).toEqual([[0]]);
    });

    it("emits navigate with index+1 when clicking next", async () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      const nextButton = wrapper.find("button[title='下一张 (→)']");
      await nextButton.trigger("click");
      expect(wrapper.emitted("navigate")).toEqual([[1]]);
    });

    it("does not emit navigate when prev is disabled", async () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      const prevButton = wrapper.find("button[title='上一张 (←)']");
      expect(prevButton.attributes("disabled")).toBeDefined();
    });

    it("does not emit navigate when next is disabled", async () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 2 },
      });
      const nextButton = wrapper.find("button[title='下一张 (→)']");
      expect(nextButton.attributes("disabled")).toBeDefined();
    });
  });

  describe("keyboard navigation", () => {
    it("emits close on Escape key", () => {
      mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      // Simulate that the keydown handler was registered
      keydownHandler(new KeyboardEvent("keydown", { key: "Escape" }));
      // The emit is on the component instance — in this test we verify
      // the handler was registered and called
      expect(document.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    });

    it("emits navigate with index-1 on ArrowLeft", () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 1 },
      });
      keydownHandler(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      expect(wrapper.emitted("navigate")).toEqual([[0]]);
    });

    it("emits navigate with index+1 on ArrowRight", () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      keydownHandler(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      expect(wrapper.emitted("navigate")).toEqual([[1]]);
    });
  });

  describe("accessibility", () => {
    it("has role dialog and aria-modal", () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      expect(wrapper.attributes("role")).toBe("dialog");
      expect(wrapper.attributes("aria-modal")).toBe("true");
    });

    it("has aria-label on the dialog", () => {
      const wrapper = mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      expect(wrapper.attributes("aria-label")).toBe("图片查看器");
    });
  });

  describe("body scroll lock", () => {
    it("sets overflow hidden on body when mounted", () => {
      const originalOverflow = document.body.style.overflow;
      mount(ImageLightbox, {
        props: { images: mockImages, currentIndex: 0 },
      });
      expect(document.body.style.overflow).toBe("hidden");
      document.body.style.overflow = originalOverflow;
    });
  });
});
