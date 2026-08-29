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
import type { ReaderProfile } from "../../api/reader/auth";
import type { ReaderPushSubscription } from "../../api/reader/notifications";

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
const mockSetSeriesFollowNotify = vi.fn();
const mockFetchReaderCategoryFollows = vi.fn();
const mockUnfollowReaderCategory = vi.fn();
const mockSetCategoryFollowNotify = vi.fn();
const mockFetchReaderTagFollows = vi.fn();
const mockUnfollowReaderTag = vi.fn();
const mockSetTagFollowNotify = vi.fn();
const mockFetchMyPostSubscriptions = vi.fn();
const mockUnsubscribeFromPostThread = vi.fn();

vi.mock("~~/api/reader/follows", () => ({
	getReaderSeriesFollows: mockFetchReaderSeriesFollows,
	unfollowReaderSeries: mockUnfollowReaderSeries,
	setSeriesFollowNotify: mockSetSeriesFollowNotify,
	getReaderCategoryFollows: mockFetchReaderCategoryFollows,
	unfollowReaderCategory: mockUnfollowReaderCategory,
	setCategoryFollowNotify: mockSetCategoryFollowNotify,
	getReaderTagFollows: mockFetchReaderTagFollows,
	unfollowReaderTag: mockUnfollowReaderTag,
	setTagFollowNotify: mockSetTagFollowNotify,
}));
vi.mock("../../api/reader/account", () => ({
	changeReaderPassword: mockChangeMyPassword,
	deleteReaderAccount: mockDeleteReaderAccount,
	getReaderDataExport: mockFetchReaderDataExport,
	updateReaderProfile: mockUpdateMyProfile,
}));
vi.mock("../../api/reader/notifications", () => ({
	getMyPushSubscriptions: mockFetchPushSubscriptions,
	revokeMyPushSubscription: mockRevokePushSubscription,
	updateMyPushSubscriptionPrefs: mockUpdatePushSubscriptionPrefs,
}));
vi.mock("../../api/reader/subscriptions", () => ({
	getMyPostSubscriptions: mockFetchMyPostSubscriptions,
	unsubscribeFromPostThread: mockUnsubscribeFromPostThread,
}));
vi.mock("../../api/public/taxonomy", () => ({
	getCategories: mockFetchCategories,
}));

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

	it("clearing the display name does not disable Save (ISS-127)", async () => {
		isAuthenticated.value = true;
		mockUpdateMyProfile.mockResolvedValue({
			id: 1,
			email: "r@example.com",
			display_name: "X",
		});
		const wrapper = await mountPage();

		const input = wrapper.get("input[type='text']");
		await input.setValue("");
		await wrapper.get("button").trigger("click"); // save
		await flushPromises();

		expect(mockUpdateMyProfile).not.toHaveBeenCalled();
		expect(wrapper.get("button").attributes("disabled")).toBeUndefined();

		// Still functional afterwards — a valid name saves fine.
		await input.setValue("NewName");
		await wrapper.get("button").trigger("click");
		await flushPromises();
		expect(mockUpdateMyProfile).toHaveBeenCalledWith({ display_name: "NewName" });
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
				account: { email: "x@x.com" },
				bookmarks: [],
				comments: [],
				history: [],
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
			mockFetchReaderSeriesFollows.mockResolvedValue({ items, total: items.length });
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
					items: [{ id: 5, title: "Tutorial", slug: "tutorial", notify: true }],
					total: 1,
				})
				.mockResolvedValueOnce({ items: [], total: 0 });
			mockUnfollowReaderSeries.mockResolvedValue(undefined);
			vi.stubGlobal("confirm", () => true);

			const wrapper = await mountPage();
			expect(wrapper.text()).toContain("Tutorial");

			const section = wrapper.findAll("section").find((s) => s.text().includes("关注的系列"));
			expect(section).toBeDefined();
			if (!section) throw new Error("series section not found");
			const unfollowBtn = section.findAll("button").find((b) => b.text() === "取消关注");
			expect(unfollowBtn).toBeDefined();
			if (!unfollowBtn) throw new Error("unfollow button not found");
			await unfollowBtn.trigger("click");
			await flushPromises();

			expect(mockUnfollowReaderSeries).toHaveBeenCalledWith(5);
			expect(mockFetchReaderSeriesFollows).toHaveBeenCalledTimes(2); // initial + reload
			expect(wrapper.text()).toContain("还没有关注任何系列");
			vi.unstubAllGlobals();
		});

		it("toggles new-part notifications for a followed series (TASK-181)", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockFetchReaderSeriesFollows.mockResolvedValue({
				items: [{ id: 5, title: "Tutorial", slug: "tutorial", notify: true }],
				total: 1,
			});
			mockSetSeriesFollowNotify.mockResolvedValue({
				series_id: 5,
				series_slug: "tutorial",
				following: true,
				notify: false,
			});

			const wrapper = await mountPage();
			const section = wrapper.findAll("section").find((s) => s.text().includes("关注的系列"));
			if (!section) throw new Error("series section not found");
			expect(section.text()).toContain("通知已开");

			const notifyBtn = section.findAll("button").find((b) => b.text() === "通知已开");
			expect(notifyBtn).toBeDefined();
			if (!notifyBtn) throw new Error("notify toggle not found");
			await notifyBtn.trigger("click");
			await flushPromises();

			expect(mockSetSeriesFollowNotify).toHaveBeenCalledWith(5, false);
			expect(mockUnfollowReaderSeries).not.toHaveBeenCalled();
			expect(section.text()).toContain("通知已关");
		});
	});

	describe("followed categories (DEC-140, TASK-182)", () => {
		function mockCatFollows(items: Array<{ id: number; name: string; notify: boolean }> = []) {
			mockFetchReaderCategoryFollows.mockResolvedValue({ items, total: items.length });
		}

		it("shows an empty state when following no categories", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockCatFollows([]);
			const wrapper = await mountPage();
			expect(wrapper.text()).toContain("还没有关注任何分类");
		});

		it("lists categories and unfollows after confirmation", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockFetchReaderCategoryFollows
				.mockResolvedValueOnce({
					items: [{ id: 4, name: "AI", notify: true }],
					total: 1,
				})
				.mockResolvedValueOnce({ items: [], total: 0 });
			mockUnfollowReaderCategory.mockResolvedValue(undefined);
			vi.stubGlobal("confirm", () => true);

			const wrapper = await mountPage();
			expect(wrapper.text()).toContain("AI");

			const section = wrapper.findAll("section").find((s) => s.text().includes("关注的分类"));
			expect(section).toBeDefined();
			if (!section) throw new Error("categories section not found");
			const unfollowBtn = section.findAll("button").find((b) => b.text() === "取消关注");
			expect(unfollowBtn).toBeDefined();
			if (!unfollowBtn) throw new Error("category unfollow button not found");
			await unfollowBtn.trigger("click");
			await flushPromises();

			expect(mockUnfollowReaderCategory).toHaveBeenCalledWith(4);
			expect(mockFetchReaderCategoryFollows).toHaveBeenCalledTimes(2);
			expect(wrapper.text()).toContain("还没有关注任何分类");
			vi.unstubAllGlobals();
		});

		it("toggles notifications for a followed category (TASK-182)", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockFetchReaderCategoryFollows.mockResolvedValue({
				items: [{ id: 4, name: "AI", notify: true }],
				total: 1,
			});
			mockSetCategoryFollowNotify.mockResolvedValue({
				category_id: 4,
				category_name: "AI",
				following: true,
				notify: false,
			});

			const wrapper = await mountPage();
			const section = wrapper.findAll("section").find((s) => s.text().includes("关注的分类"));
			if (!section) throw new Error("categories section not found");
			expect(section.text()).toContain("通知已开");

			const notifyBtn = section.findAll("button").find((b) => b.text() === "通知已开");
			expect(notifyBtn).toBeDefined();
			if (!notifyBtn) throw new Error("category notify toggle not found");
			await notifyBtn.trigger("click");
			await flushPromises();

			expect(mockSetCategoryFollowNotify).toHaveBeenCalledWith(4, false);
			expect(mockUnfollowReaderCategory).not.toHaveBeenCalled();
			expect(section.text()).toContain("通知已关");
		});
	});

	describe("followed tags (DEC-195, TASK-215)", () => {
		function mockTagFollows(items: Array<{ id: number; name: string; notify: boolean }> = []) {
			mockFetchReaderTagFollows.mockResolvedValue({ items, total: items.length });
		}

		it("shows an empty state when following no tags", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockTagFollows([]);
			const wrapper = await mountPage();
			expect(wrapper.text()).toContain("还没有关注任何标签");
		});

		it("lists followed tags, #-prefixed and unfollows after confirmation", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockFetchReaderTagFollows
				.mockResolvedValueOnce({
					items: [{ id: 3, name: "Rust", notify: true }],
					total: 1,
				})
				.mockResolvedValueOnce({ items: [], total: 0 });
			mockUnfollowReaderTag.mockResolvedValue(null);
			vi.stubGlobal("confirm", () => true);

			const wrapper = await mountPage();
			expect(wrapper.text()).toContain("#Rust");

			const section = wrapper.findAll("section").find((s) => s.text().includes("关注的标签"));
			expect(section).toBeDefined();
			if (!section) throw new Error("tags section not found");
			const unfollowBtn = section.findAll("button").find((b) => b.text() === "取消关注");
			expect(unfollowBtn).toBeDefined();
			if (!unfollowBtn) throw new Error("tag unfollow button not found");
			await unfollowBtn.trigger("click");
			await flushPromises();

			expect(mockUnfollowReaderTag).toHaveBeenCalledWith(3);
			expect(mockFetchReaderTagFollows).toHaveBeenCalledTimes(2); // initial + reload
			expect(wrapper.text()).toContain("还没有关注任何标签");
			vi.unstubAllGlobals();
		});

		it("toggles notifications for a followed tag (TASK-215)", async () => {
			isAuthenticated.value = true;
			mockFetchPushSubscriptions.mockResolvedValue({ items: [], total: 0 });
			mockFetchReaderTagFollows.mockResolvedValue({
				items: [{ id: 3, name: "Rust", notify: true }],
				total: 1,
			});
			mockSetTagFollowNotify.mockResolvedValue({
				tag_id: 3,
				tag_name: "Rust",
				following: true,
				notify: false,
			});

			const wrapper = await mountPage();
			const section = wrapper.findAll("section").find((s) => s.text().includes("关注的标签"));
			if (!section) throw new Error("tags section not found");
			expect(section.text()).toContain("通知已开");

			const notifyBtn = section.findAll("button").find((b) => b.text() === "通知已开");
			expect(notifyBtn).toBeDefined();
			if (!notifyBtn) throw new Error("tag notify toggle not found");
			await notifyBtn.trigger("click");
			await flushPromises();

			expect(mockSetTagFollowNotify).toHaveBeenCalledWith(3, false);
			expect(mockUnfollowReaderTag).not.toHaveBeenCalled();
			expect(section.text()).toContain("通知已关");
		});
	});
});
