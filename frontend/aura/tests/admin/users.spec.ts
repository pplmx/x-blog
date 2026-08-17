/**
 * Admin Users Page Tests
 *
 * Tests the admin users page: loading state, error state, empty state,
 * creating a user (with input validation + password match), deleting a user
 * with confirmation, and the self-delete guard.
 *
 * Mocks the fetchAdminUsers, createAdminUser, deleteAdminUser composables.
 * Uses a <Suspense> wrapper since the page uses `await fetchAdminUsers()` in
 * <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const { mockFetchAdminUsers, mockCreateAdminUser, mockDeleteAdminUser } = vi.hoisted(() => ({
	mockFetchAdminUsers: vi.fn(),
	mockCreateAdminUser: vi.fn(),
	mockDeleteAdminUser: vi.fn(),
}));

vi.mock("~/composables/useApi", () => ({
	fetchAdminUsers: mockFetchAdminUsers,
	createAdminUser: mockCreateAdminUser,
	deleteAdminUser: mockDeleteAdminUser,
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
			// Third input is the submit button (there are 3 inputs + 1 button)
			await wrapper.find("button[type=submit]").trigger("submit");
			await flushPromises();

			expect(mockCreateAdminUser).toHaveBeenCalledWith({
				username: "newadmin",
				password: "secretpass1",
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
	});
});
