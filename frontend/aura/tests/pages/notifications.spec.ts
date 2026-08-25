/**
 * Reader notification inbox page tests (DEC-160, TASK-192; prefs DEC-171/TASK-202).
 *
 * Verifies the empty state, the newest-first list with read/unread badges and
 * kind labels, deep-link hrefs, single mark-as-read, mark-all-read, and the
 * per-kind notification-preferences card (loads all-on, toggles a kind via
 * updateReaderNotificationPref, rolls back on error). Auth and useApi are
 * mocked so the inbox is deterministic. Guests are redirected to /login.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { ReaderNotification, ReaderNotificationPrefs } from "../../api/reader/notifications";

const isAuthenticated = ref(false);
const mockLogout = vi.fn();
const mockReplace = vi.fn();
vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated, reader: ref(null), logout: mockLogout }),
}));

vi.mock("../../composables/useSeo", () => ({ useSeo: vi.fn() }));

const mockFetch = vi.fn();
const mockMarkRead = vi.fn(async (id: number) => ({
	id,
	kind: "reply",
	title: "有人回复了你的评论",
	read: true,
}));
const mockMarkAllRead = vi.fn(async () => ({ updated: 2 }));
const mockFetchPrefs = vi.fn(
	async (): Promise<ReaderNotificationPrefs> => ({
		new_post: true,
		reply: true,
		thread_comment: true,
	}),
);
const mockUpdatePref = vi.fn(
	async (
		kind: keyof ReaderNotificationPrefs,
		enabled: boolean,
	): Promise<ReaderNotificationPrefs> => ({
		new_post: kind === "new_post" ? enabled : true,
		reply: kind === "reply" ? enabled : true,
		thread_comment: kind === "thread_comment" ? enabled : true,
	}),
);

vi.mock("../../api/reader/notifications", () => ({
	getReaderNotifications: mockFetch,
	markReaderNotificationRead: mockMarkRead,
	markAllReaderNotificationsRead: mockMarkAllRead,
	getReaderNotificationPrefs: mockFetchPrefs,
	updateReaderNotificationPref: mockUpdatePref,
}));

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
};

let NotificationsPage: unknown;

async function mountPage() {
	isAuthenticated.value = true;
	vi.stubGlobal("useRouter", () => ({ replace: mockReplace }));
	NotificationsPage =
		NotificationsPage ?? (await import("../../app/pages/notifications.vue")).default;
	const wrapper = mount(NotificationsPage as never, {
		global: {
			stubs,
		},
	});
	await flushPromises();
	return wrapper;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

function makeNotif(overrides: Partial<ReaderNotification> = {}): ReaderNotification {
	return {
		id: 1,
		kind: "new_post",
		title: "新文章发布",
		body: "《A》",
		url: "/posts/a",
		read: false,
		created_at: "2026-08-23T00:00:00Z",
		...overrides,
	};
}

describe("Notifications page (TASK-192)", () => {
	beforeEach(() => {
		isAuthenticated.value = true;
		mockFetch.mockReset();
		mockMarkRead.mockClear();
		mockMarkAllRead.mockClear();
		mockFetchPrefs.mockReset();
		mockUpdatePref.mockClear();
		mockLogout.mockClear();
		mockReplace.mockClear();
		mockFetch.mockResolvedValue({
			items: [],
			total: 0,
			unread: 0,
			page: 1,
			limit: 100,
			total_pages: 0,
		});
		mockFetchPrefs.mockResolvedValue({
			new_post: true,
			reply: true,
			thread_comment: true,
		});
	});

	it("renders the empty state when there are no notifications", async () => {
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("通知中心");
		expect(wrapper.text()).toContain("暂无通知");
	});

	it("lists notifications newest-first with read/unread and deep links", async () => {
		mockFetch.mockResolvedValue({
			items: [
				makeNotif({ id: 2, kind: "reply", title: "有人回复了你的评论", url: "/posts/a#comment-9" }),
				makeNotif({ id: 1, title: "新文章发布", read: true }),
			],
			total: 2,
			unread: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("有人回复了你的评论");
		expect(wrapper.text()).toContain("新文章发布");
		expect(wrapper.find('a[href="/posts/a#comment-9"]').exists()).toBe(true);
	});

	it("marks a single notification read", async () => {
		const item = makeNotif({ id: 5, kind: "thread_comment", title: "你订阅的讨论有新评论" });
		mockFetch.mockResolvedValue({
			items: [item],
			total: 1,
			unread: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const wrapper = await mountPage();
		const buttons = wrapper.findAll("button");
		await buttons[buttons.length - 1].trigger("click");
		await flushPromises();
		expect(mockMarkRead).toHaveBeenCalledWith(5);
	});

	it("marks all notifications read", async () => {
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 1 }), makeNotif({ id: 2 })],
			total: 2,
			unread: 2,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const wrapper = await mountPage();
		const markAll = wrapper.findAll("button").find((b) => b.text().includes("全部标为已读"));
		expect(markAll).toBeDefined();
		await markAll?.trigger("click");
		await flushPromises();
		expect(mockMarkAllRead).toHaveBeenCalled();
	});

	it("renders a localized network error when the inbox fetch fails (ISS-110)", async () => {
		mockFetch.mockRejectedValue(new Error("boom"));
		const wrapper = await mountPage();
		// The orphaned common.errors.network key is now defined in zh locale,
		// so the page shows a real message instead of the raw key.
		expect(wrapper.text()).toContain("网络错误，请稍后重试");
		expect(mockLogout).not.toHaveBeenCalled();
		expect(mockReplace).not.toHaveBeenCalled();
	});

	it("logs an expired session out and redirects to login on a 401 (ISS-110)", async () => {
		mockFetch.mockRejectedValue({ statusCode: 401 });
		const wrapper = await mountPage();
		expect(mockLogout).toHaveBeenCalledTimes(1);
		expect(mockReplace).toHaveBeenCalledWith("/login");
		// No misleading network-error banner when the cause is an stale session.
		expect(wrapper.text()).not.toContain("网络错误，请稍后重试");
	});

	it("loads the preferences card with every kind on (DEC-171)", async () => {
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("通知偏好");
		const switches = wrapper.findAll('button[role="switch"]');
		expect(switches).toHaveLength(3);
		for (const s of switches) {
			expect(s.attributes("aria-checked")).toBe("true");
		}
	});

	it("toggles a kind off and persists via updateReaderNotificationPref", async () => {
		const wrapper = await mountPage();
		const switches = wrapper.findAll('button[role="switch"]');
		// Order is new_post, reply, thread_comment.
		await switches[1].trigger("click");
		await flushPromises();
		expect(mockUpdatePref).toHaveBeenCalledWith("reply", false);
		expect(switches[1].attributes("aria-checked")).toBe("false");
		// Other kinds are untouched.
		expect(switches[0].attributes("aria-checked")).toBe("true");
		expect(switches[2].attributes("aria-checked")).toBe("true");
	});

	it("rolls a failed toggle back and shows the error hint", async () => {
		mockUpdatePref.mockRejectedValueOnce(new Error("boom"));
		const wrapper = await mountPage();
		const switches = wrapper.findAll('button[role="switch"]');
		await switches[0].trigger("click");
		await flushPromises();
		expect(switches[0].attributes("aria-checked")).toBe("true"); // rolled back
		expect(wrapper.text()).toContain("网络错误，请稍后重试");
	});
});
