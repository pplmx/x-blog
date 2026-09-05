/**
 * MediaPickerModal component tests (DEC-183, TASK-207).
 *
 * The post-editor toolbar opens this picker to insert a previously uploaded
 * image. Verifies it lists media (reactive data from the media API), emits
 * `select` with the image URL when one is clicked, and stays hidden when
 * closed. Content teleports to document.body, so assertions query the body.
 */

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));
vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiUrl: "http://localhost:18888" } }));

const listMock = vi.fn();
vi.mock("../../api/admin/media", () => ({
	// The modal passes its 1-based page as a computed ref (DEC-189 reactive-path
	// pattern) so the listing follows pagination. The mock preserves the ref so
	// a test can drive data reactively per page — the fixed-literal bug (page
	// always 1) would be invisible to a mock that snapshots a number here.
	useAdminMedia: (page: number | { value: number }, pageSize: number) => {
		const pageRef = page && typeof page === "object" ? page : { value: page };
		return listMock(pageRef, pageSize);
	},
}));

import MediaPickerModal from "../../components/MediaPickerModal.vue";

const image = {
	url: "/static/uploads/2026/07/11111111-2222-4444-8888-000000000001.png",
	year: 2026,
	month: 7,
	filename: "11111111-2222-4444-8888-000000000001.png",
	size: 2048,
	width: 1200,
	height: 800,
	uploaded_at: "2026-07-15T10:00:00Z",
	referenced: true,
	referencing_posts: [],
};

function fakeQuery(items: unknown[]) {
	return {
		data: ref({ items, pagination: { total: items.length, page: 1, limit: 60, total_pages: 1 } }),
		pending: ref(false),
		error: ref(null),
		refresh: vi.fn(() => Promise.resolve()),
	};
}

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

function mountPicker(open = true) {
	const Wrap: any = {
		components: { MediaPickerModal },
		props: ["open"],
		template:
			"<Suspense>" +
			"<template #default><MediaPickerModal :open='open' /></template>" +
			"<template #fallback>Loading…</template>" +
			"</Suspense>",
	};
	return mount(Wrap, {
		props: { open },
		attachTo: document.body,
		global: { stubs: { Icon: iconStub } },
	});
}

describe("MediaPickerModal", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("hidden when closed", () => {
		listMock.mockReturnValue(fakeQuery([]));
		mountPicker(false);
		expect(document.body.textContent || "").not.toContain("components.mediaPicker.title");
	});

	it("requests the media list only when opened (round 263 lazy-fetch contract)", async () => {
		// The picker is always-mounted twice in the post editor (media + cover).
		// Before round 263 its eager useFetch fired two duplicate
		// /api/upload/files?page_size=60 calls on EVERY editor page load even
		// though the file's comment claimed laziness. The fix suppresses the
		// mount fetch (immediate:false) and drives loading from the open-watcher
		// (immediate:true), so a closed picker must not request, and opening it
		// must — locking in the only remaining data path.
		const result = fakeQuery([image]);
		listMock.mockReturnValue(result);
		const wrapper = mountPicker(false);
		expect(result.refresh).not.toHaveBeenCalled();
		await wrapper.setProps({ open: true });
		await vi.waitFor(() => {
			expect(result.refresh).toHaveBeenCalled();
		});
	});

	it("lists media from the API", async () => {
		listMock.mockReturnValue(fakeQuery([image]));
		mountPicker();
		await vi.waitFor(() => {
			expect(document.body.querySelectorAll("img").length).toBe(1);
		});
		const imageEl = document.body.querySelector("img");
		expect(imageEl).not.toBeNull();
		const src = imageEl?.getAttribute("src") ?? "";
		expect(src).toContain(image.url);
	});

	it("Next/Prev fetch the target page via the reactive page ref (TASK-232)", async () => {
		// Two pages of one image each: paging must move the request to the next
		// page, not re-fetch page 1 (the old literal-1 bug).
		const pageA = { ...image, url: image.url.replace("000000000001", "000000000001p1") };
		const pageB = { ...image, url: image.url.replace("000000000001", "000000000002p2") };
		const pageRefState = { ref: null as null | { value: number } };
		listMock.mockImplementation((page: { value: number }) => {
			pageRefState.ref = page;
			return {
				data: computed(() => ({
					items: page.value === 1 ? [pageA] : [pageB],
					pagination: { total: 2, page: page.value, limit: 60, total_pages: 2 },
				})),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(() => Promise.resolve()),
			};
		});
		mountPicker();

		// The grid renders <img :src=...>, so match page identity by src URL
		// (filename/alt is unchanged between the two pages).
		await vi.waitFor(() => {
			expect(document.body.querySelector('img[src*="000000000001p1"]')).not.toBeNull();
		});

		const nextBtn = Array.from(document.body.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("components.mediaPicker.next"),
		);
		if (!nextBtn) throw new Error("expected a next button");
		(nextBtn as HTMLButtonElement).click();

		await vi.waitFor(() => {
			expect(document.body.querySelector('img[src*="000000000002p2"]')).not.toBeNull();
		});
		// The ref used to request the data now points at page 2.
		expect(pageRefState.ref?.value).toBe(2);
	});

	it("emits select with the image URL on click", async () => {
		listMock.mockReturnValue(fakeQuery([image]));
		const wrapper = mountPicker();
		await vi.waitFor(() => {
			expect(document.body.querySelectorAll("img").length).toBe(1);
		});
		const tile = document.body.querySelectorAll("button");
		const imageTile = Array.from(tile).find((b) => b.querySelector("img"));
		if (!imageTile) throw new Error("expected a media tile containing an image");
		(imageTile as HTMLButtonElement).click();
		const modal = wrapper.findComponent(MediaPickerModal);
		const emitted = modal.emitted("select");
		expect(emitted).toBeDefined();
		expect(emitted?.[0]).toEqual([image.url]);
		expect(modal.emitted("close")).toBeDefined();
	});

	it("emits close via the X button", async () => {
		listMock.mockReturnValue(fakeQuery([image]));
		const wrapper = mountPicker();
		await vi.waitFor(() => {
			expect(document.body.querySelectorAll("img").length).toBe(1);
		});
		const closeBtn = document.body.querySelector(
			'[aria-label="common.menu.close"]',
		) as HTMLButtonElement;
		closeBtn.click();
		expect(wrapper.findComponent(MediaPickerModal).emitted("close")).toBeDefined();
	});

	it("closes on Escape (ISS-132)", async () => {
		listMock.mockReturnValue(fakeQuery([image]));
		const wrapper = mountPicker();
		await vi.waitFor(() => {
			expect(document.body.querySelectorAll("img").length).toBe(1);
		});
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(wrapper.findComponent(MediaPickerModal).emitted("close")).toBeDefined();
	});

	it("moves focus to the close button on open and restores it on close (ISS-132)", async () => {
		listMock.mockReturnValue(fakeQuery([image]));
		const trigger = document.createElement("button");
		trigger.textContent = "picker-trigger";
		document.body.appendChild(trigger);
		trigger.focus();

		const wrapper = mountPicker(false);
		await wrapper.setProps({ open: true });
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(
				document.querySelector('[aria-label="common.menu.close"]'),
			);
		});

		await wrapper.setProps({ open: false });
		await wrapper.vm.$nextTick();
		expect(document.activeElement).toBe(trigger);
		document.body.removeChild(trigger);
	});

	it("traps Tab focus within the panel (ISS-132)", async () => {
		listMock.mockReturnValue(fakeQuery([image]));
		const wrapper = mountPicker(false);
		await wrapper.setProps({ open: true });
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(
				document.querySelector('[aria-label="common.menu.close"]'),
			);
		});
		// Scope to the dialog panel so the "last focusable" can't be a stray
		// test-appended button elsewhere in <body>.
		const panel = document.querySelector('[role="dialog"]');
		const panelButtons = panel ? Array.from(panel.querySelectorAll("button")) : [];
		// Shift+Tab from the first focusable (the close button) wraps to the last.
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
		expect(document.activeElement).toBe(panelButtons[panelButtons.length - 1]);
	});
});
