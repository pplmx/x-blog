/**
 * Account settings page tests (DEC-067, TASK-142).
 *
 * Three sections: edit display name (PATCH + setProfile), rotate password
 * (POST + updateToken with the fresh session), and push-device management
 * (list + revoke with confirm). Logged-out visitors see a sign-in prompt.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { ReaderProfile, ReaderPushSubscription } from "../../composables/useApi";

const isAuthenticated = ref(false);
const reader = ref<ReaderProfile | null>(null);
const setProfile = vi.fn();
const updateToken = vi.fn();
const logout = vi.fn();

vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated, reader, setProfile, updateToken, logout }),
}));

vi.mock("../../composables/useSeo", () => ({
	useSeo: vi.fn(),
}));

const mockUpdateMyProfile = vi.fn();
const mockChangeMyPassword = vi.fn();
const mockFetchPushSubscriptions = vi.fn();
const mockRevokePushSubscription = vi.fn();
const mockFetchCategories = vi.fn();
const mockUpdatePushSubscriptionPrefs = vi.fn();
const mockDeleteReaderAccount = vi.fn();
const mockFetchReaderDataExport = vi.fn();
const mockFetchReaderSeriesFollows = vi.fn();
const mockUnfollowReaderSeries = vi.fn();

vi.mock("../../composables/useApi", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../../composables/useApi")>();
	return {
		...orig,
		updateMyProfile: mockUpdateMyProfile,
		changeMyPassword: mockChangeMyPassword,
		fetchMyPushSubscriptions: mockFetchPushSubscriptions,
		revokeMyPushSubscription: mockRevokePushSubscription,
		fetchCategories: mockFetchCategories,
		updateMyPushSubscriptionPrefs: mockUpdatePushSubscriptionPrefs,
		deleteReaderAccount: mockDeleteReaderAccount,
		fetchReaderDataExport: mockFetchReaderDataExport,
		fetchReaderSeriesFollows: mockFetchReaderSeriesFollows,
		unfollowReaderSeries: mockUnfollowReaderSeries,
	};
});

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
	NuxtLink: { template: '<a class="nuxt-link-stub"><slot/></a>' },
};

let Account: unknown;

async function mountPage() {
	Account = Account ?? (await import("../../app/pages/account.vue")).default;
	const wrapper = mount(Account as never, { global: { stubs } });
	await flushPromises();
	return wrapper;
}

function makeDevice(overrides: Partial<ReaderPushSubscription> = {}): ReaderPushSubscription {
	return {
		id: 1,
		endpoint: "https://fcm.example.com/wpush/v2/abcd",
		created_at: "2024-01-15T10:00:00Z",
		want_new_posts: false,
		new_post_category_id: null,
		...overrides,
	};
}

afterEach(() => {
	vi.clearAllMocks();
	isAuthenticated.value = false;
	reader.value = null;
});

describe("Account settings page", () => {
	it("shows a sign-in prompt when logged out", async () => {
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("登录后可以管理你的账号设置");
	});

	it("lists push devices and shows an empty state when none", async () => {
		isAuthenticated.value = true;
		mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("还没有绑定任何推送设备");
	});

	it("renders a bound device with a revoke action", async () => {
		isAuthenticated.value = true;
		mockFetchPushSubscriptions.mockResolvedValue({ items: [makeDevice()], total: 1 });
		const wrapper = await mountPage();
		// endpoint host is surfaced for identification
		expect(wrapper.text()).toContain("fcm.example.com");
	});

	it("revokes a device after confirmation and reloads the list", async () => {
		isAuthenticated.value = true;
		mockFetchPushSubscriptions
			.mockResolvedValueOnce({ items: [makeDevice()], total: 1 })
			.mockResolvedValueOnce({ items: [], total: 0 });
		mockRevokePushSubscription.mockResolvedValue(undefined);
		vi.stubGlobal("confirm", () => true);

		const wrapper = await mountPage();
		// Buttons: [0]=save profile, [1]=change password, [2]=revoke device.
		await wrapper.findAll("button")[2].trigger("click");
		await flushPromises();

		expect(mockRevokePushSubscription).toHaveBeenCalledWith(1);
		expect(mockFetchPushSubscriptions).toHaveBeenCalledTimes(2); // reloaded
		vi.unstubAllGlobals();
	});

	it("defaults a device to no new-post notifications", async () => {
		isAuthenticated.value = true;
		mockFetchPushSubscriptions.mockResolvedValue({ items: [makeDevice()], total: 1 });
		const wrapper = await mountPage();

		const checkbox = wrapper.get("input[type='checkbox']") as unknown as {
			element: { checked: boolean };
		};
		expect(checkbox.element.checked).toBe(false);
		expect(wrapper.find("select").exists()).toBe(false);
	});

	it("opts a device into all new posts per the toggle", async () => {
		isAuthenticated.value = true;
		mockFetchPushSubscriptions.mockResolvedValue({ items: [makeDevice()], total: 1 });
		mockUpdatePushSubscriptionPrefs.mockResolvedValue(makeDevice({ want_new_posts: true }));
		const wrapper = await mountPage();

		await wrapper.get("input[type='checkbox']").setValue(true);
		await flushPromises();

		expect(mockUpdatePushSubscriptionPrefs).toHaveBeenCalledWith(1, {
			want_new_posts: true,
			new_post_category_id: null,
		});
	});

	it("scopes a followed device to a chosen category", async () => {
		isAuthenticated.value = true;
		mockFetchCategories.mockResolvedValue([{ id: 7, name: "Python" }]);
		mockFetchPushSubscriptions.mockResolvedValue({
			items: [makeDevice({ want_new_posts: true })],
			total: 1,
		});
		mockUpdatePushSubscriptionPrefs.mockResolvedValue(
			makeDevice({ want_new_posts: true, new_post_category_id: 7 }),
		);
		const wrapper = await mountPage();

		await wrapper.get("select").setValue("7");
		await flushPromises();

		expect(mockUpdatePushSubscriptionPrefs).toHaveBeenCalledWith(1, {
			want_new_posts: true,
			new_post_category_id: 7,
		});
	});

	it("saves the display name and refreshes the profile", async () => {
		isAuthenticated.value = true;
		mockUpdateMyProfile.mockResolvedValue({
			id: 1,
			email: "r@example.com",
			display_name: "NewName",
		});
		const wrapper = await mountPage();

		const input = wrapper.get("input[type='text']");
		await input.setValue("NewName");
		await wrapper.get("button").trigger("click"); // save
		await flushPromises();

		expect(mockUpdateMyProfile).toHaveBeenCalledWith({ display_name: "NewName" });
		expect(setProfile).toHaveBeenCalledWith(expect.objectContaining({ display_name: "NewName" }));
		expect(wrapper.text()).toContain("已保存");
	});

	it("rejects a short new password without calling the API", async () => {
		isAuthenticated.value = true;
		const wrapper = await mountPage();
		const inputs = wrapper.findAll("input[type='password']");
		await inputs[0].setValue("currentpass");
		await inputs[1].setValue("short");
		await inputs[2].setValue("short");
		await wrapper.findAll("button")[1].trigger("click");
		await flushPromises();

		expect(mockChangeMyPassword).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("新密码至少 8 位");
	});

	it("rejects a password mismatch without calling the API", async () => {
		isAuthenticated.value = true;
		const wrapper = await mountPage();
		const inputs = wrapper.findAll("input[type='password']");
		await inputs[0].setValue("currentpass");
		await inputs[1].setValue("newpass456");
		await inputs[2].setValue("newpass000");
		await wrapper.findAll("button")[1].trigger("click");
		await flushPromises();

		expect(mockChangeMyPassword).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("两次输入的新密码不一致");
	});

	it("changes the password and persists the fresh session token", async () => {
		isAuthenticated.value = true;
		mockChangeMyPassword.mockResolvedValue({
			access_token: "fresh.jwt",
			token_type: "bearer",
			reader: { id: 1, email: "r@example.com", display_name: "R" },
		});
		const wrapper = await mountPage();
		const inputs = wrapper.findAll("input[type='password']");
		await inputs[0].setValue("currentpass123");
		await inputs[1].setValue("newpass456");
		await inputs[2].setValue("newpass456");
		await wrapper.findAll("button")[1].trigger("click");
		await flushPromises();

		expect(mockChangeMyPassword).toHaveBeenCalledWith({
			current_password: "currentpass123",
			new_password: "newpass456",
		});
		expect(updateToken).toHaveBeenCalledWith(
			expect.objectContaining({ access_token: "fresh.jwt" }),
		);
		expect(wrapper.text()).toContain("密码已修改");
	});

	it("shows a wrong-current-password error surfaced from the API", async () => {
		isAuthenticated.value = true;
		mockChangeMyPassword.mockRejectedValue({ status: 401 });
		const wrapper = await mountPage();
		const inputs = wrapper.findAll("input[type='password']");
		await inputs[0].setValue("nope");
		await inputs[1].setValue("newpass456");
		await inputs[2].setValue("newpass456");
		await wrapper.findAll("button")[1].trigger("click");
		await flushPromises();

		expect(wrapper.text()).toContain("当前密码不正确");
	});

	describe("delete account (DEC-106, TASK-165)", () => {
		it("deletes the account after confirming the password", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockDeleteReaderAccount.mockResolvedValue(undefined);
			vi.stubGlobal("confirm", () => true);
			const navigateTo = vi.fn();
			vi.stubGlobal("navigateTo", navigateTo);

			const wrapper = await mountPage();
			const section = wrapper.findAll("section").find((s) => s.text().includes("删除账号"));
			expect(section).toBeDefined();
			if (!section) throw new Error("delete section not found");
			await section.findAll("input[type='password']")[0].setValue("readerpass123");
			await section.find("button").trigger("click");
			await flushPromises();

			expect(mockDeleteReaderAccount).toHaveBeenCalledWith("readerpass123");
			expect(logout).toHaveBeenCalled();
			expect(navigateTo).toHaveBeenCalledWith("/");
			vi.unstubAllGlobals();
		});

		it("shows a wrong-password error when deletion is rejected 401", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockDeleteReaderAccount.mockRejectedValue({ status: 401 });
			vi.stubGlobal("confirm", () => true);
			vi.stubGlobal("navigateTo", vi.fn());

			const wrapper = await mountPage();
			const section = wrapper.findAll("section").find((s) => s.text().includes("删除账号"));
			if (!section) throw new Error("delete section not found");
			await section.findAll("input[type='password']")[0].setValue("nope");
			await section.find("button").trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("密码错误");
			vi.unstubAllGlobals();
		});
	});

	describe("data export (TASK-175)", () => {
		it("downloads the data bundle after confirmation", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockFetchReaderDataExport.mockResolvedValue({
				data: {
					value: { account: { email: "x@x.com" }, bookmarks: [], comments: [], history: [] },
				},
			});
			const createObjectURL = vi.fn(() => "blob:test");
			vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
			vi.stubGlobal("confirm", () => true);

			const wrapper = await mountPage();
			const btn = wrapper.findAll("button").find((b) => b.text().includes("下载我的数据"));
			await btn?.trigger("click");
			await flushPromises();

			expect(mockFetchReaderDataExport).toHaveBeenCalled();
			expect(createObjectURL).toHaveBeenCalled();
			expect(wrapper.text()).toContain("数据已导出");
			vi.unstubAllGlobals();
		});

		it("does not download when cancelled", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			vi.stubGlobal("confirm", () => false);

			const wrapper = await mountPage();
			const btn = wrapper.findAll("button").find((b) => b.text().includes("下载我的数据"));
			await btn?.trigger("click");

			expect(mockFetchReaderDataExport).not.toHaveBeenCalled();
			vi.unstubAllGlobals();
		});

		it("shows a failure message on export error", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockFetchReaderDataExport.mockRejectedValue(new Error("boom"));
			vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
			vi.stubGlobal("confirm", () => true);

			const wrapper = await mountPage();
			const btn = wrapper.findAll("button").find((b) => b.text().includes("下载我的数据"));
			await btn?.trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("导出失败");
			vi.unstubAllGlobals();
		});
	});

	describe("followed series (DEC-134, TASK-179)", () => {
		function mockFollows(items: Array<{ id: number; title: string; slug: string }> = []) {
			mockFetchReaderSeriesFollows.mockResolvedValue({
				data: { value: { items, total: items.length } },
			});
		}

		it("shows an empty state when following no series", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockFollows([]);
			const wrapper = await mountPage();
			expect(wrapper.text()).toContain("还没有关注任何系列");
		});

		it("lists followed series and unfollows after confirmation", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockFetchReaderSeriesFollows
				.mockResolvedValueOnce({
					data: { value: { items: [{ id: 5, title: "Tutorial", slug: "tutorial" }], total: 1 } },
				})
				.mockResolvedValueOnce({ data: { value: { items: [], total: 0 } } });
			mockUnfollowReaderSeries.mockResolvedValue(undefined);
			vi.stubGlobal("confirm", () => true);

			const wrapper = await mountPage();
			expect(wrapper.text()).toContain("Tutorial");

			const section = wrapper.findAll("section").find((s) => s.text().includes("关注的系列"));
			expect(section).toBeDefined();
			if (!section) throw new Error("series section not found");
			await section.find("button").trigger("click");
			await flushPromises();

			expect(mockUnfollowReaderSeries).toHaveBeenCalledWith(5);
			expect(mockFetchReaderSeriesFollows).toHaveBeenCalledTimes(2); // initial + reload
			expect(wrapper.text()).toContain("还没有关注任何系列");
			vi.unstubAllGlobals();
		});
	});
});
