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
import { ref } from "vue";

const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));
vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiUrl: "http://localhost:18888" } }));

const listMock = vi.fn();
vi.mock("../../api/admin/media", () => ({
	useAdminMedia: (page: number, pageSize: number) => listMock(page, pageSize),
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
});
