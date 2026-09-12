/**
 * MarkdownLightbox component tests (DEC-302, TASK-379)
 *
 * The fullscreen viewer for post images. Contract:
 *   - renders nothing while `index` is null
 *   - shows the indexed image at full size + a numeric counter
 *   - Escape / backdrop / close button close (emits update:index === null)
 *   - arrow keys navigate backwards/forwards with wrap-around
 *   - opens with keyboard focus inside the dialog and returns it on close
 *   - locks body scroll while open
 *
 * The overlay teleports to <body>, so assertions query document.body rather
 * than the wrapper (teleported nodes are outside the mount tree).
 */

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

vi.mock("~/components/Icon.vue", () => ({
	default: {
		name: "Icon",
		template: '<svg data-testid="icon" :data-icon="icon"></svg>',
		props: ["icon"],
	},
}));

import MarkdownLightbox from "../../components/MarkdownLightbox.vue";

const images = [
	{ src: "/static/uploads/a.png", alt: "Diagram A" },
	{ src: "/static/uploads/b.png", alt: "Diagram B" },
];

function mountLightbox(index: number | null) {
	return mount(MarkdownLightbox, {
		props: { images, index },
	});
}

function overlayEl(): HTMLElement | null {
	return document.querySelector('[data-testid="lightbox"]');
}

/** Query an element the test expects to exist; a miss fails loudly. */
function mustEl<T extends Element>(selector: string): T {
	const el = document.querySelector(selector);
	if (!el) throw new Error(`expected "${selector}" in the DOM`);
	return el as T;
}

function overlayImg(): HTMLImageElement {
	return mustEl<HTMLImageElement>('[data-testid="lightbox"] img');
}

function keyOnOverlay(key: string) {
	mustEl('[data-testid="lightbox"]').dispatchEvent(
		new KeyboardEvent("keydown", { key, bubbles: true }),
	);
}

describe("MarkdownLightbox", () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = "";
		document.body.style.overflow = "";
	});

	it("renders nothing while closed (index null)", () => {
		mountLightbox(null);
		expect(overlayEl()).toBeNull();
	});

	it("opens on a defined index and shows the image + counter", async () => {
		mountLightbox(0);
		await nextTick();
		expect(overlayEl()).not.toBeNull();
		expect(overlayImg().getAttribute("src")).toBe("/static/uploads/a.png");
		expect(document.body.textContent).toContain("1 / 2");
	});

	it("Escape closes (emits update:index null)", async () => {
		const wrapper = mountLightbox(0);
		await nextTick();
		keyOnOverlay("Escape");
		expect(wrapper.emitted("update:index")).toEqual([[null]]);
	});

	it("backdrop click closes", async () => {
		const wrapper = mountLightbox(0);
		await nextTick();
		mustEl('[data-testid="lightbox-backdrop"]').dispatchEvent(
			new MouseEvent("click", { bubbles: true }),
		);
		expect(wrapper.emitted("update:index")).toEqual([[null]]);
	});

	it("the close button closes", async () => {
		const wrapper = mountLightbox(1);
		await nextTick();
		mustEl<HTMLButtonElement>('[data-testid="lightbox-close"]').click();
		expect(wrapper.emitted("update:index")).toEqual([[null]]);
	});

	it("arrow right advances with wrap-around", async () => {
		const wrapper = mountLightbox(images.length - 1);
		await nextTick();
		keyOnOverlay("ArrowRight");
		expect(wrapper.emitted("update:index")).toEqual([[0]]);
	});

	it("arrow left goes backwards with wrap-around", async () => {
		const wrapper = mountLightbox(0);
		await nextTick();
		keyOnOverlay("ArrowLeft");
		expect(wrapper.emitted("update:index")).toEqual([[images.length - 1]]);
	});

	it("does not navigate or close on unrelated keys", async () => {
		const wrapper = mountLightbox(0);
		await nextTick();
		keyOnOverlay("a");
		keyOnOverlay("Home");
		expect(wrapper.emitted("update:index")).toBeUndefined();
	});

	it("traps Tab inside the modal (wraps at the edges)", async () => {
		const wrapper = mountLightbox(0);
		await nextTick();
		// The focusable set: prev + next arrows only on a single-image viewer
		// there is just the img + no nav; use the two-image fixtures so the
		// prev/next buttons exist.
		const tabs = document.querySelectorAll<HTMLButtonElement>('[data-testid="lightbox"] button');
		expect(tabs.length).toBeGreaterThan(1);
		tabs[tabs.length - 1].focus();
		// Forward Tab from the last button wraps to the first.
		mustEl('[data-testid="lightbox"]').dispatchEvent(
			new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
		);
		await nextTick();
		expect(document.activeElement).toBe(tabs[0]);
		wrapper.unmount();
	});

	it("moves focus into the dialog on open and returns it on close", async () => {
		const trigger = document.createElement("button");
		trigger.id = "trigger";
		document.body.appendChild(trigger);
		trigger.focus();
		expect(document.activeElement).toBe(trigger);

		const wrapper = mountLightbox(1);
		await nextTick();
		// Focus lands on the (focusable) dialog container, not the trigger.
		expect(document.activeElement).not.toBe(trigger);
		expect(overlayEl()?.contains(document.activeElement)).toBe(true);

		wrapper.setProps({ index: null });
		await nextTick();
		expect(document.activeElement).toBe(trigger);
		trigger.remove();
	});

	it("locks body scroll while open and restores it after close", async () => {
		const wrapper = mountLightbox(0);
		await nextTick();
		expect(document.body.style.overflow).toBe("hidden");

		wrapper.setProps({ index: null });
		await nextTick();
		// Restored to whatever it was before (the untouched default here).
		expect(document.body.style.overflow).not.toBe("hidden");
	});

	it("closes when the image set shrinks beneath the open index (content swap)", async () => {
		const wrapper = mountLightbox(1);
		await nextTick();
		expect(document.body.style.overflow).toBe("hidden");

		// The owning post swaps to a new one with only one image.
		wrapper.setProps({ images: [images[0]] });
		await nextTick();
		expect(document.querySelector('[data-testid="lightbox"]')).toBeNull();
		// Scroll lock was released instead of stranded behind an invisible overlay.
		expect(document.body.style.overflow).not.toBe("hidden");
		expect(wrapper.emitted("update:index")).toEqual([[null]]);
	});

	it("restores body scroll if unmounted while open", async () => {
		const wrapper = mountLightbox(0);
		await nextTick();
		expect(document.body.style.overflow).toBe("hidden");

		wrapper.unmount();
		expect(document.body.style.overflow).not.toBe("hidden");
	});
});
