/**
 * Admin Readers page tests (DEC-194, TASK-214, ISS-116).
 *
 * Renders the registered-reader table from the readers API (email, status
 * chip, comment/bookmark counts), shows empty/error states, and deactivates /
 * reactivates a reader through the confirm dialog, patching the row with the
 * authoritative server state.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetchResult, mountWithSuspense, stubNuxtGlobals } from "../admin/helpers";

vi.stubGlobal("definePageMeta", vi.fn());

const listMock = vi.fn();
const deactivateMock = vi.fn();
const activateMock = vi.fn();

vi.mock("../../api/admin/readers", () => ({
	// useAdminReaders returns an AsyncData-like object the page destructures
	// as { data, pending, error }.
	useAdminReaders: (...args: unknown[]) => listMock(...args),
	deactivateReader: deactivateMock,
	activateReader: activateMock,
}));

stubNuxtGlobals();

function fakeReader(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: 1,
		email: "alice@example.com",
		display_name: "Alice",
		is_active: true,
		created_at: "2026-07-01T00:00:00Z",
		last_login_at: "2026-07-10T00:00:00Z",
		comment_count: 3,
		bookmark_count: 2,
		...overrides,
	};
}

function fakeListing(items: unknown[]) {
	return mockFetchResult({
		items,
		pagination: { total: items.length, page: 1, limit: 20, total_pages: 1 },
	});
}

let ReadersPage: unknown;
async function mountPage() {
	ReadersPage = ReadersPage ?? (await import("../../app/pages/admin/readers.vue")).default;
	return mountWithSuspense(ReadersPage as never);
}

describe("Admin Readers page", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		// Re-establish the stubbed Nuxt globals the next test relies on (the
		// media spec does the same — without this, later mounts hang in
		// Suspense's "Loading…" because useRuntimeConfig/useHead are gone).
		vi.stubGlobal("definePageMeta", vi.fn());
		stubNuxtGlobals();
	});

	it("renders reader rows with status and counts", async () => {
		listMock.mockReturnValue(
			fakeListing([fakeReader(), fakeReader({ id: 2, email: "bob@example.com" })]),
		);
		const wrapper = await mountPage();

		const rows = wrapper.findAll("tbody tr");
		expect(rows).toHaveLength(2);
		expect(rows[0].text()).toContain("alice@example.com");
		expect(rows[0].text()).toContain("Alice");
		expect(rows[0].text()).toContain("3");
		expect(rows[0].text()).toContain("2");
		// active reader gets the "正常" (active) status chip and a deactivate action
		expect(rows[0].text()).toContain("停用");
	});

	it("shows an empty state when no readers match", async () => {
		listMock.mockReturnValue(fakeListing([]));
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("没有匹配的读者");
	});

	it("surfaces a load error", async () => {
		listMock.mockReturnValue(mockFetchResult(null, { error: new Error("network") }));
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("加载读者列表失败");
	});

	it("deactivates a reader after confirmation and patches the row inactive", async () => {
		listMock.mockReturnValue(fakeListing([fakeReader()]));
		vi.stubGlobal(
			"confirm",
			vi.fn(() => true),
		);
		deactivateMock.mockResolvedValue({
			id: 1,
			email: "alice@example.com",
			is_active: false,
			last_login_at: "2026-07-10T00:00:00Z",
		});
		const wrapper = await mountPage();

		await wrapper.find("tbody tr button").trigger("click");
		await flushPromises();
		await flushPromises();

		expect(deactivateMock).toHaveBeenCalledWith(1);
		const row = wrapper.find("tbody tr");
		expect(row.text()).toContain("已停用");
		expect(row.text()).toContain("启用");
	});

	it("does not deactivate when the confirmation is cancelled", async () => {
		listMock.mockReturnValue(fakeListing([fakeReader()]));
		vi.stubGlobal(
			"confirm",
			vi.fn(() => false),
		);
		const wrapper = await mountPage();

		await wrapper.find("tbody tr button").trigger("click");
		await flushPromises();

		expect(deactivateMock).not.toHaveBeenCalled();
		const row = wrapper.find("tbody tr");
		expect(row.text()).toContain("正常");
	});

	it("reactivates a deactivated reader and patches the row active", async () => {
		listMock.mockReturnValue(fakeListing([fakeReader({ is_active: false })]));
		vi.stubGlobal(
			"confirm",
			vi.fn(() => true),
		);
		activateMock.mockResolvedValue({
			id: 1,
			email: "alice@example.com",
			is_active: true,
			last_login_at: "2026-07-10T00:00:00Z",
		});
		const wrapper = await mountPage();

		await wrapper.find("tbody tr button").trigger("click");
		await flushPromises();
		await flushPromises();

		expect(activateMock).toHaveBeenCalledWith(1);
		const row = wrapper.find("tbody tr");
		expect(row.text()).toContain("正常");
		expect(row.text()).toContain("停用");
	});

	it("surfaces a toggle failure", async () => {
		listMock.mockReturnValue(fakeListing([fakeReader()]));
		vi.stubGlobal(
			"confirm",
			vi.fn(() => true),
		);
		deactivateMock.mockRejectedValue(new Error("boom"));
		const wrapper = await mountPage();

		await wrapper.find("tbody tr button").trigger("click");
		await flushPromises();
		await flushPromises();

		expect(wrapper.find("tbody tr").text()).toContain("正常");
		expect(wrapper.text()).not.toContain("加载读者列表失败");
	});

	it("tracks each row's deactivate in flight independently (deep-dive)", async () => {
		// A single `busyId` slot let Bob's toggle COMPLETE while Alice's PATCH was
		// still running and clear the shared marker — re-enabling Alice's
		// (security-relevant) button mid-flight. This test drives Bob's toggle
		// to completion while Alice is still pending and asserts Alice's marker
		// survives until her OWN promise resolves (the previous single-slot code
		// fails this: Bob's finally cleared Alice's busy state).
		listMock.mockReturnValue(
			fakeListing([fakeReader(), fakeReader({ id: 2, email: "bob@example.com" })]),
		);
		vi.stubGlobal(
			"confirm",
			vi.fn(() => true),
		);
		let resolveFirst!: (v: unknown) => void;
		const firstCall = new Promise((resolve) => {
			resolveFirst = resolve;
		});
		deactivateMock
			.mockImplementationOnce(() => firstCall)
			.mockResolvedValue({
				id: 2,
				email: "bob@example.com",
				is_active: false,
				last_login_at: "2026-07-10T00:00:00Z",
			});
		const wrapper = await mountPage();

		const rowButtons = () => wrapper.findAll("tbody tr button");
		await rowButtons()[0].trigger("click"); // deactivate Alice (in flight)
		await flushPromises();
		expect((rowButtons()[0].element as HTMLButtonElement).disabled).toBe(true);
		expect(rowButtons()[0].attributes("aria-busy")).toBe("true");
		expect(rowButtons()[0].text()).toContain("处理中");
		// Bob's row is unaffected — its own marker is not set by Alice's flight.
		expect((rowButtons()[1].element as HTMLButtonElement).disabled).toBe(false);

		// Bob's toggle RUNS AND COMPLETES while Alice's is still pending.
		await rowButtons()[1].trigger("click");
		await flushPromises();
		expect((rowButtons()[1].element as HTMLButtonElement).disabled).toBe(false); // Bob done
		// Alice's marker was NOT cleared by Bob's completion — still in flight.
		expect((rowButtons()[0].element as HTMLButtonElement).disabled).toBe(true);
		expect(rowButtons()[0].attributes("aria-busy")).toBe("true");

		resolveFirst({ id: 1, email: "alice@example.com", is_active: false });
		await flushPromises();
		expect((rowButtons()[0].element as HTMLButtonElement).disabled).toBe(false);
		expect(rowButtons()[0].text()).toContain("启用");
	});
});
