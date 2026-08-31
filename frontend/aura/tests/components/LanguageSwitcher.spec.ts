/**
 * LanguageSwitcher component tests.
 *
 * Mocks `useLang` for deterministic control of the locale. Verifies the
 * dropdown behaviour with a multi-language locale list (simplified/
 * traditional Chinese, English, Japanese, Korean): the compact trigger shows
 * the current locale, the menu opens on click listing every locale uniformly
 * (labels are whitespace-nowrap so no locale name wraps), selection updates
 * the locale and closes the menu, and outside-click / Escape dismiss.
 *
 * Real layout (line-height/wrapping) is verified in the e2e/browser since
 * happy-dom does not lay out the page; here we assert structure and state.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Ref, ref } from "vue";

const locale: Ref<string> = ref("zh-Hans");
const setLocale = vi.fn((l: string) => {
	locale.value = l;
});

vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({
		locale,
		setLocale,
		locales: [
			{ code: "zh-Hans", native: "简体中文" },
			{ code: "zh-Hant", native: "繁體中文" },
			{ code: "en", native: "English" },
			{ code: "ja", native: "日本語" },
			{ code: "ko", native: "한국어" },
		],
	}),
}));

import LanguageSwitcher from "../../components/LanguageSwitcher.vue";

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

function mountSwitcher(opts: { attachTo?: HTMLElement | string } = {}) {
	return mount(LanguageSwitcher, {
		...opts,
		global: { stubs: { Icon: iconStub } },
	});
}

const ALL_NATIVES = ["简体中文", "繁體中文", "English", "日本語", "한국어"];

describe("LanguageSwitcher", () => {
	beforeEach(() => {
		locale.value = "zh-Hans";
		setLocale.mockClear();
	});

	it("renders the current locale as a compact, fixed-width trigger", () => {
		const wrapper = mountSwitcher();
		const trigger = wrapper.find('button[aria-haspopup="menu"]');
		expect(trigger.exists()).toBe(true);
		expect(trigger.text()).toContain("简体中文");
		// Fixed width + centered so the trigger does not resize when the
		// current language label changes.
		expect(trigger.classes()).toContain("w-24");
		expect(trigger.classes()).toContain("justify-center");
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});

	it("opens the menu and lists every supported locale uniformly", async () => {
		const wrapper = mountSwitcher();
		await wrapper.get('button[aria-haspopup="menu"]').trigger("click");
		await flushPromises();

		const menu = wrapper.find('[role="menu"]');
		expect(menu.exists()).toBe(true);
		// The menu has a fixed width (does not auto-fit per language).
		expect(menu.classes()).toContain("w-36");
		const items = wrapper.findAll('[role="menuitem"]');
		expect(items.map((i) => i.text().trim())).toEqual(ALL_NATIVES);
		// Every item uses the same non-wrapping layout (no item overrides it).
		for (const it of items) {
			expect(it.classes()).toContain("whitespace-nowrap");
		}
		expect(wrapper.get('button[aria-haspopup="menu"]').attributes("aria-expanded")).toBe("true");
	});

	it("marks the active locale and selects a different one", async () => {
		const wrapper = mountSwitcher();
		await wrapper.get('button[aria-haspopup="menu"]').trigger("click");
		await flushPromises();

		const active = wrapper.find('[role="menuitem"][aria-current="true"]');
		expect(active.text().trim()).toBe("简体中文");

		await wrapper.get('[role="menuitem"]:nth-child(4)').trigger("click");
		await flushPromises();

		expect(setLocale).toHaveBeenCalledWith("ja");
		expect(locale.value).toBe("ja");
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});

	it("closes the menu on an outside click", async () => {
		const wrapper = mountSwitcher();
		await wrapper.get('button[aria-haspopup="menu"]').trigger("click");
		await flushPromises();
		expect(wrapper.find('[role="menu"]').exists()).toBe(true);

		document.body.click();
		await flushPromises();
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});

	it("closes the menu on Escape", async () => {
		const wrapper = mountSwitcher();
		await wrapper.get('button[aria-haspopup="menu"]').trigger("click");
		await flushPromises();
		expect(wrapper.find('[role="menu"]').exists()).toBe(true);

		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		await flushPromises();
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});

	it("moves focus between locale items with ArrowDown/ArrowUp", async () => {
		// Focus assertions need the tree attached (VTU mounts detached by default,
		// where .focus() never becomes document.activeElement).
		const wrapper = mountSwitcher({ attachTo: document.body });
		try {
			await wrapper.get('button[aria-haspopup="menu"]').trigger("click");
			await flushPromises();

			// Opening moves focus onto the current locale's item (first, zh-Hans).
			const items = wrapper.findAll('[role="menuitem"]');
			expect(items[0].element).toBe(document.activeElement);

			document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
			expect(items[1].element).toBe(document.activeElement); // 繁體中文
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
			expect(items[0].element).toBe(document.activeElement); // wraps back
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
			expect(items[items.length - 1].element).toBe(document.activeElement);
		} finally {
			wrapper.unmount();
		}
	});

	it("returns focus to the trigger when a language is selected", async () => {
		const wrapper = mountSwitcher({ attachTo: document.body });
		try {
			const trigger = wrapper.get('button[aria-haspopup="menu"]');
			await trigger.trigger("click");
			await flushPromises();

			await wrapper.get('[role="menuitem"]:nth-child(3)').trigger("click");
			await flushPromises();
			expect(wrapper.find('[role="menu"]').exists()).toBe(false);
			// Focus returns to the trigger, not <body> (the menuitem is un-mounted).
			expect(window.document.activeElement).toBe(trigger.element);
		} finally {
			wrapper.unmount();
		}
	});

	it("returns focus to the trigger when the menu closes on Escape", async () => {
		const wrapper = mountSwitcher({ attachTo: document.body });
		try {
			const trigger = wrapper.get('button[aria-haspopup="menu"]');
			await trigger.trigger("click");
			await flushPromises();

			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
			await flushPromises();
			expect(wrapper.find('[role="menu"]').exists()).toBe(false);
			expect(window.document.activeElement).toBe(trigger.element);
		} finally {
			wrapper.unmount();
		}
	});
});
