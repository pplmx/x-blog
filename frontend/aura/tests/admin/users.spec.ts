/**
 * Admin Users Page Tests
 *
 * Tests the admin users page: loading state, error state, empty state,
 * creating a user (with input validation + password match), deleting a user
 * with confirmation, and the self-delete guard.
 *
 * Mocks the useAdminUsers, createAdminUser, deleteAdminUser api/admin/users functions.
 * Uses a <Suspense> wrapper since the page uses `await useAdminUsers()` in
 * <script setup>.
 */

import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const { mockFetchAdminUsers, mockCreateAdminUser, mockDeleteAdminUser, mockUpdateAdminUser } =
	vi.hoisted(() => ({
		mockFetchAdminUsers: vi.fn(),
		mockCreateAdminUser: vi.fn(),
		mockDeleteAdminUser: vi.fn(),
		mockUpdateAdminUser: vi.fn(),
	}));

vi.mock("~~/api/admin/users", () => ({
	useAdminUsers: mockFetchAdminUsers,
	createAdminUser: mockCreateAdminUser,
	deleteAdminUser: mockDeleteAdminUser,
	updateAdminUser: mockUpdateAdminUser,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

const originalConfirm = window.confirm;
const originalLocalStorageGetItem = window.localStorage?.getItem;

const mockUsers = [
	{ id: 1, username: "admin", is_superuser: true },
	{ id: 2, username: "editor", is_superuser: false },
];

async function loadPage() {
	const { default: UsersPage } = await import("@/pages/admin/users.vue");
	return UsersPage;
}

describe("Admin Users Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		window.confirm = originalConfirm;
		if (window.localStorage) {
			window.localStorage.getItem =
				originalLocalStorageGetItem as typeof window.localStorage.getItem;
		}
	});

	describe("Loading state", () => {
		it("renders loading message when users are pending", async () => {
			mockFetchAdminUsers.mockReturnValue({
				data: ref(null),
				pending: ref(true),
				error: ref(null),
				refresh: vi.fn(),
			});

			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);
			expect(wrapper.text()).toContain("加载中");
		});
	});

	describe("Error state", () => {
		it("renders error message when fetch fails", async () => {
			mockFetchAdminUsers.mockReturnValue({
				data: ref(null),
				pending: ref(false),
				error: ref({ message: "Fetch error" }),
				refresh: vi.fn(),
			});

			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);
			expect(wrapper.text()).toContain("Fetch error");
		});
	});

	describe("Empty state", () => {
		it("renders empty state when no users exist", async () => {
			mockFetchAdminUsers.mockReturnValue({
				data: ref([]),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);
			expect(wrapper.text()).toContain("暂无用户");
		});
	});

	describe("Populated state", () => {
		beforeEach(() => {
			// Default: no JWT in localStorage, so currentUserId stays null.
			if (window.localStorage) {
				window.localStorage.getItem = vi.fn(() => null);
			}
			mockFetchAdminUsers.mockReturnValue({
				data: ref(structuredClone(mockUsers)),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		it("renders the page heading", async () => {
			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);
			expect(wrapper.text()).toContain("管理用户");
		});

		it("renders existing usernames and superuser badge", async () => {
			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);
			expect(wrapper.text()).toContain("admin");
			expect(wrapper.text()).toContain("editor");
			expect(wrapper.text()).toContain("超级管理员");
		});

		it("creates a user when valid input is provided", async () => {
			mockCreateAdminUser.mockResolvedValue({});

			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("newadmin");
			await inputs[1].setValue("secretpass1");
			await inputs[2].setValue("secretpass1");
			// Fourth input is the optional pen name (DEC-359/TASK-405); the
			// bio textarea is separate (round 357); the submit button follows
			// (4 inputs + 1 button).
			await wrapper.find("button[type=submit]").trigger("submit");
			await flushPromises();

			expect(mockCreateAdminUser).toHaveBeenCalledWith({
				username: "newadmin",
				password: "secretpass1",
				display_name: null,
				bio: null,
			});
		});

		it("passes the public pen name when provided at create", async () => {
			mockCreateAdminUser.mockResolvedValue({});

			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("newadmin");
			await inputs[1].setValue("secretpass1");
			await inputs[2].setValue("secretpass1");
			await inputs[3].setValue("Riki the Writer");
			await wrapper.find("button[type=submit]").trigger("submit");
			await flushPromises();

			expect(mockCreateAdminUser).toHaveBeenCalledWith({
				username: "newadmin",
				password: "secretpass1",
				display_name: "Riki the Writer",
				bio: null,
			});
		});

		it("does not create a user when passwords mismatch", async () => {
			mockCreateAdminUser.mockResolvedValue({});

			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("newadmin");
			await inputs[1].setValue("secretpass1");
			await inputs[2].setValue("different1");
			await wrapper.find("button[type=submit]").trigger("submit");
			await flushPromises();

			expect(mockCreateAdminUser).not.toHaveBeenCalled();
			expect(wrapper.text()).toContain("两次输入的密码不一致");
		});

		it("single-flights a double submit so a duplicate admin is never created (sibling-guard parity)", async () => {
			// The submit button is disabled once processing starts, but a redundant
			// submit event (Enter then click, or a double fire before the disabled
			// state paints) would otherwise issue two createAdminUser calls — two
			// admin accounts with the same credentials. Every sibling create form
			// (categories/tags/series) carries this guard (deep-dive finding).
			let resolveCreate: (v: unknown) => void;
			const pendingCreate = new Promise((resolve) => {
				resolveCreate = resolve;
			});
			mockCreateAdminUser.mockReturnValue(pendingCreate);

			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("newadmin");
			await inputs[1].setValue("secretpass1");
			await inputs[2].setValue("secretpass1");
			// Trigger on the FORM (like the reader-login single-flight spec): the
			// submit button disables once processing starts, so clicking IT twice is
			// already inert — the real double-fire is a form submit that bypasses
			// the disabled button (Enter in the input fires the <form>`s handler).
			const form = wrapper.find("form");
			await form.trigger("submit");
			await form.trigger("submit");
			await flushPromises();

			expect(mockCreateAdminUser).toHaveBeenCalledTimes(1);

			resolveCreate?.({});
			await flushPromises();
		});

		it("deletes a user after confirmation", async () => {
			mockDeleteAdminUser.mockResolvedValue({});
			window.confirm = vi.fn(() => true);

			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);

			const deleteButtons = wrapper.findAll("button").filter((b) => b.text().includes("删除"));
			await deleteButtons[0].trigger("click");
			await flushPromises();

			expect(mockDeleteAdminUser).toHaveBeenCalledWith(1);
		});

		it("disables delete for the current user (decoded from JWT sub)", async () => {
			// Fake JWT whose payload sub = 1 (the admin user id).
			const b64u = (s: string) =>
				btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
			const token = `${b64u('{"alg":"HS256"}')}.${b64u('{"sub":1}')}.sig`;
			if (window.localStorage) {
				window.localStorage.getItem = vi.fn(() => token);
			}

			const UsersPage = await loadPage();
			const wrapper = await mountWithSuspense(UsersPage);

			const deleteButtons = wrapper.findAll("button").filter((b) => b.text().includes("删除"));
			// admin (id 1) is the current user -> its delete button is disabled.
			expect(deleteButtons[0].attributes("disabled")).toBeDefined();
			// editor (id 2) is still deletable.
			expect(deleteButtons[1].attributes("disabled")).toBeUndefined();
		});

		describe("public pen name (DEC-359/TASK-405)", () => {
			const editButtons = (wrapper: VueWrapper) => wrapper.findAll("button[aria-label='编辑笔名']");
			// After the editor opens, the row's pen-name input is the last
			// <input> in the DOM. Guard with explicit throws (not `!`) so the
			// non-null assertions neither appear in the test nor fail the gate.
			function editorInput(wrapper: VueWrapper) {
				const inputs = wrapper.findAll("input");
				const input = inputs[inputs.length - 1];
				if (!input) throw new Error("expected the pen-name editor input");
				return input;
			}
			function findButton(wrapper: VueWrapper, text: string) {
				const button = wrapper.findAll("button").find((b) => b.text().includes(text));
				if (!button) throw new Error(`expected a button containing "${text}"`);
				return button;
			}

			it("shows an existing pen name under the username", async () => {
				mockFetchAdminUsers.mockReturnValue({
					data: ref([
						{ id: 1, username: "admin", is_superuser: true, display_name: "Riki" },
						{ id: 2, username: "editor", is_superuser: false },
					]),
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				});

				const UsersPage = await loadPage();
				const wrapper = await mountWithSuspense(UsersPage);
				expect(wrapper.text()).toContain("Riki");
				expect(wrapper.text()).toContain("未设置公开笔名");
			});

			it("saves a new pen name inline via PATCH", async () => {
				mockUpdateAdminUser.mockResolvedValue({});

				const UsersPage = await loadPage();
				const wrapper = await mountWithSuspense(UsersPage);

				// Open the editor on the first (admin) row.
				await editButtons(wrapper)[0].trigger("click");
				await editorInput(wrapper).setValue("New Pen");
				// The inline Save button lives in the editing row.
				await findButton(wrapper, "保存").trigger("click");
				await flushPromises();

				expect(mockUpdateAdminUser).toHaveBeenCalledWith(1, { display_name: "New Pen" });
			});

			it("clears the pen name with an empty save (back to no public identity)", async () => {
				mockUpdateAdminUser.mockResolvedValue({});

				const UsersPage = await loadPage();
				const wrapper = await mountWithSuspense(UsersPage);

				await editButtons(wrapper)[0].trigger("click");
				await editorInput(wrapper).setValue("   ");
				await findButton(wrapper, "保存").trigger("click");
				await flushPromises();

				expect(mockUpdateAdminUser).toHaveBeenCalledWith(1, { display_name: null });
			});

			it("cancel discards the draft without calling PATCH", async () => {
				mockUpdateAdminUser.mockResolvedValue({});

				const UsersPage = await loadPage();
				const wrapper = await mountWithSuspense(UsersPage);

				await editButtons(wrapper)[0].trigger("click");
				await editorInput(wrapper).setValue("Discarded");
				// "取消" only appears on the inline cancel — the create form has
				// no cancel button, so the filter needs no further disambiguation.
				await findButton(wrapper, "取消").trigger("click");
				await flushPromises();

				expect(mockUpdateAdminUser).not.toHaveBeenCalled();
			});
		});

		describe("public 'about this writer' bio (round 357)", () => {
			const bioButtons = (wrapper: VueWrapper) => wrapper.findAll("button[aria-label='编辑简介']");
			// The bio editor is a <textarea>; the create form's bio textarea is
			// the first one, per-row editors are added after the pen-name input.
			function bioEditor(wrapper: VueWrapper) {
				const textareas = wrapper.findAll("textarea");
				const bio = textareas[textareas.length - 1];
				if (!bio) throw new Error("expected the bio editor textarea");
				return bio;
			}
			function findButton(wrapper: VueWrapper, text: string) {
				const button = wrapper.findAll("button").find((b) => b.text().includes(text));
				if (!button) throw new Error(`expected a button containing "${text}"`);
				return button;
			}

			it("shows an existing writer bio under the username", async () => {
				mockFetchAdminUsers.mockReturnValue({
					data: ref([
						{
							id: 1,
							username: "admin",
							is_superuser: true,
							display_name: "Riki",
							bio: "Long-form on type systems.",
						},
						{ id: 2, username: "editor", is_superuser: false },
					]),
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				});

				const UsersPage = await loadPage();
				const wrapper = await mountWithSuspense(UsersPage);
				expect(wrapper.text()).toContain("Long-form on type systems.");
				expect(wrapper.text()).toContain("无作者简介");
			});

			it("saves a writer bio inline via PATCH", async () => {
				mockUpdateAdminUser.mockResolvedValue({});

				const UsersPage = await loadPage();
				const wrapper = await mountWithSuspense(UsersPage);

				await bioButtons(wrapper)[0].trigger("click");
				await bioEditor(wrapper).setValue("Design researcher by day.");
				await findButton(wrapper, "保存").trigger("click");
				await flushPromises();

				expect(mockUpdateAdminUser).toHaveBeenCalledWith(1, {
					bio: "Design researcher by day.",
				});
			});

			it("clears the writer bio with an empty save (back to no bio)", async () => {
				mockUpdateAdminUser.mockResolvedValue({});

				const UsersPage = await loadPage();
				const wrapper = await mountWithSuspense(UsersPage);

				await bioButtons(wrapper)[0].trigger("click");
				await bioEditor(wrapper).setValue("   ");
				await findButton(wrapper, "保存").trigger("click");
				await flushPromises();

				expect(mockUpdateAdminUser).toHaveBeenCalledWith(1, { bio: null });
			});
		});
	});
});
