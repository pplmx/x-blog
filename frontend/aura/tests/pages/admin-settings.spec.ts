/**
 * Admin Settings page tests (DEC-100, TASK-162).
 *
 * Loads the current auto-approve setting from the admin endpoint and toggles it
 * back through PUT, showing a saved/error state.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// Nuxt-only macros (`definePageMeta`, `useHead`) aren't defined under vitest;
// stub them as no-ops for this page test.
vi.stubGlobal("definePageMeta", vi.fn());
vi.stubGlobal("useHead", vi.fn());

const mockFetchSiteSetting = vi.fn();
const mockUpdateSiteSetting = vi.fn();

vi.mock("../../api/admin/settings", () => ({
	getSiteSetting: mockFetchSiteSetting,
	updateSiteSetting: mockUpdateSiteSetting,
}));

vi.mock("../../composables/useSeo", () => ({ useSeo: vi.fn() }));

let SettingsPage: unknown;
async function mountPage() {
	SettingsPage = SettingsPage ?? (await import("../../app/pages/admin/settings.vue")).default;
	// The page awaits its initial load in <script setup>, so it needs a
	// Suspense boundary (same pattern as the other component/page specs).
	const SuspenseWrapper: any = {
		components: { SettingsPage },
		template:
			"<Suspense>" +
			`<template #default><SettingsPage /></template>` +
			"<template #fallback>Loading…</template>" +
			"</Suspense>",
	};
	const wrapper = mount(SuspenseWrapper, {
		global: {
			stubs: { Icon: { template: '<svg class="icon-stub" />' } },
		},
	});
	await flushPromises();
	return wrapper;
}

describe("Admin Settings page", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("loads and reflects the persisted true setting", async () => {
		mockFetchSiteSetting.mockResolvedValue({
			key: "auto_approve_reader_comments",
			value: "true",
		});
		const wrapper = await mountPage();
		await flushPromises();
		const checkbox = wrapper.find('input[type="checkbox"]');
		expect((checkbox.element as HTMLInputElement).checked).toBe(true);
		expect(mockFetchSiteSetting).toHaveBeenCalledWith("auto_approve_reader_comments");
	});

	it("shows the checkbox unchecked when the setting is false", async () => {
		mockFetchSiteSetting.mockResolvedValue({
			key: "auto_approve_reader_comments",
			value: "false",
		});
		const wrapper = await mountPage();
		await flushPromises();
		const checkbox = wrapper.find('input[type="checkbox"]');
		expect((checkbox.element as HTMLInputElement).checked).toBe(false);
	});

	it("saves the toggled value", async () => {
		mockFetchSiteSetting.mockResolvedValue({
			key: "auto_approve_reader_comments",
			value: "false",
		});
		mockUpdateSiteSetting.mockResolvedValue({
			data: { value: { key: "auto_approve_reader_comments", value: "true" } },
			pending: false,
		});
		const wrapper = await mountPage();
		await flushPromises();

		const checkbox = wrapper.find('input[type="checkbox"]');
		await checkbox.setValue(true);
		await wrapper.find("button").trigger("click");
		await flushPromises();

		expect(mockUpdateSiteSetting).toHaveBeenCalledWith("auto_approve_reader_comments", "true");
		expect(wrapper.text()).toContain("设置已保存");
	});

	it("clears the saved banner when the toggle changes after saving", async () => {
		// "设置已保存" describes persisted state — flipping the checkbox after a
		// save makes it stale, so the banner must vanish until saved again
		// (RIL ISS-285).
		mockFetchSiteSetting.mockResolvedValue({
			key: "auto_approve_reader_comments",
			value: "false",
		});
		mockUpdateSiteSetting.mockResolvedValue({
			data: { value: { key: "auto_approve_reader_comments", value: "true" } },
			pending: false,
		});
		const wrapper = await mountPage();
		await flushPromises();

		const checkbox = wrapper.find('input[type="checkbox"]');
		await checkbox.setValue(true);
		await wrapper.find("button").trigger("click");
		await flushPromises();
		expect(wrapper.text()).toContain("设置已保存");

		// Flip again without saving: the banner disappears immediately.
		await checkbox.setValue(false);
		await flushPromises();
		expect(wrapper.text()).not.toContain("设置已保存");
	});
});
