/**
 * LanguageSwitcher component tests.
 *
 * Mocks `useLang` for deterministic control of the locale. Verifies the
 * dropdown behaviour: a compact trigger showing the current locale, a menu
 * that opens on click with both locales, selection updating the locale and
 * closing the menu, and outside-click / Escape dismiss.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Ref, ref } from "vue";

const locale: Ref<"zh" | "en"> = ref("zh");
const setLocale = vi.fn((l: "zh" | "en") => {
	locale.value = l;
});

vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({
		locale,
		setLocale,
		locales: [
			{ code: "zh", native: "中文" },
			{ code: "en", native: "English" },
		],
	}),
}));

import LanguageSwitcher from "../../components/LanguageSwitcher.vue";

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

function mountSwitcher() {
	return mount(LanguageSwitcher, {
		global: { stubs: { Icon: iconStub } },
	});
}

describe("LanguageSwitcher", () => {
	beforeEach(() => {
		locale.value = "zh";
		setLocale.mockClear();
	});

	it("renders the current locale as a compact trigger", () => {
		const wrapper = mountSwitcher();
		const trigger = wrapper.find('button[aria-haspopup="true"]');
		expect(trigger.exists()).toBe(true);
		expect(trigger.text()).toContain("中文");
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});

	it("opens the menu on click and lists both locales", async () => {
		const wrapper = mountSwitcher();
		await wrapper.get('button[aria-haspopup="true"]').trigger("click");
		await flushPromises();

		const menu = wrapper.find('[role="menu"]');
		expect(menu.exists()).toBe(true);
		const items = wrapper.findAll('[role="menuitem"]');
		expect(items.map((i) => i.text().trim())).toEqual(["中文", "English"]);
		expect(wrapper.get('button[aria-haspopup="true"]').attributes("aria-expanded")).toBe("true");
	});

	it("selecting a locale updates state and closes the menu", async () => {
		const wrapper = mountSwitcher();
		await wrapper.get('button[aria-haspopup="true"]').trigger("click");
		await flushPromises();

		await wrapper.get('[role="menuitem"]:nth-child(2)').trigger("click");
		await flushPromises();

		expect(setLocale).toHaveBeenCalledWith("en");
		expect(locale.value).toBe("en");
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});

	it("closes the menu on an outside click", async () => {
		const wrapper = mountSwitcher();
		await wrapper.get('button[aria-haspopup="true"]').trigger("click");
		await flushPromises();
		expect(wrapper.find('[role="menu"]').exists()).toBe(true);

		document.body.click();
		await flushPromises();
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});

	it("closes the menu on Escape", async () => {
		const wrapper = mountSwitcher();
		await wrapper.get('button[aria-haspopup="true"]').trigger("click");
		await flushPromises();
		expect(wrapper.find('[role="menu"]').exists()).toBe(true);

		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		await flushPromises();
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});
});
