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
// Faithful copy of useReaderAuth.isStaleSession (the inbox has no
// business-level 401, so a bare statusCode 401 is always a dead session).
const isStaleSession = vi.fn(
	(cause: unknown) =>
		(cause as { statusCode?: number } | undefined)?.statusCode === 401 ||
		(cause as { response?: { status?: number } } | undefined)?.response?.status === 401,
);
vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({
		isAuthenticated,
		reader: ref(null),
		logout: mockLogout,
		isStaleSession,
	}),
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
const mockDeleteRow = vi.fn(async (_id: number) => undefined);
const mockFetchPrefs = vi.fn(
	async (): Promise<ReaderNotificationPrefs> => ({
		new_post: true,
		reply: true,
		thread_comment: true,
		mention: true,
		reader_comment: true,
		email_new_post: false,
		email_reply: false,
		email_thread_comment: false,
		email_mention: false,
		email_weekly_digest: false,
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
		mention: kind === "mention" ? enabled : true,
		reader_comment: kind === "reader_comment" ? enabled : true,
		email_new_post: kind === "email_new_post" ? enabled : false,
		email_reply: kind === "email_reply" ? enabled : false,
		email_thread_comment: kind === "email_thread_comment" ? enabled : false,
		email_mention: kind === "email_mention" ? enabled : false,
		email_weekly_digest: kind === "email_weekly_digest" ? enabled : false,
	}),
);

vi.mock("../../api/reader/notifications", () => ({
	getReaderNotifications: mockFetch,
	markReaderNotificationRead: mockMarkRead,
	markAllReaderNotificationsRead: mockMarkAllRead,
	deleteReaderNotification: mockDeleteRow,
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

/** The shared nav-badge singleton, loaded lazily so the api/useReaderAuth
 * vi.mock factories (which reference top-level consts) initialize first. */
async function badgeApi() {
	return (await import("../../composables/useNotificationBadge")).useNotificationBadge();
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
		mockDeleteRow.mockClear();
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
			mention: true,
			reader_comment: true,
			email_new_post: false,
			email_reply: false,
			email_thread_comment: false,
			email_mention: false,
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

	it("labels a series-new-part event with the series kind (ISS-114)", async () => {
		// The backend now emits kind=series_new_part for a new part of a followed
		// series; the page must render the distinct 系列更新 label (not the
		// generic 新文章发布) so series updates are visible as such.
		mockFetch.mockResolvedValue({
			items: [
				makeNotif({
					id: 7,
					kind: "series_new_part",
					title: "系列更新",
					body: "《Part 2》",
					url: "/posts/part-2",
				}),
			],
			total: 1,
			unread: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("系列更新");
		const link = wrapper.find('a[href="/posts/part-2"]');
		expect(link.exists()).toBe(true);
	});

	it("renders a mention notification with its kind label (DEC-322)", async () => {
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 9, kind: "mention", title: "有人在评论中提到了你" })],
			total: 1,
			unread: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("有人在评论中提到了你");
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
		// The shared nav badge mirrors the inbox unread count (ISS-124/TASK-224).
		const badge = await badgeApi();
		expect(badge.unreadCount.value).toBe(1);
		// Marking read re-fetches the shared count from the server (KEEP the
		// post-action server truth), so the next GET reflects the drop.
		mockFetch.mockResolvedValue({
			items: [item],
			total: 1,
			unread: 0,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		// Target the mark-read control by its aria-label (not a positional
		// index — the row gained a delete sibling, so the last button is no
		// longer unambiguously mark-read, DEC-312).
		const markReadBtn = wrapper
			.findAll("button")
			.find((b) => b.attributes("aria-label") === "标为已读");
		expect(markReadBtn).toBeDefined();
		await markReadBtn?.trigger("click");
		await flushPromises();
		expect(mockMarkRead).toHaveBeenCalledWith(5);
		expect(badge.unreadCount.value).toBe(0);
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
		const badge = await badgeApi();
		expect(badge.unreadCount.value).toBe(2);
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 1 }), makeNotif({ id: 2 })],
			total: 2,
			unread: 0,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const markAll = wrapper.findAll("button").find((b) => b.text().includes("全部标为已读"));
		expect(markAll).toBeDefined();
		await markAll?.trigger("click");
		await flushPromises();
		expect(mockMarkAllRead).toHaveBeenCalled();
		expect(badge.unreadCount.value).toBe(0);
	});

	it("surfaces a failure and re-enables the button when mark-all fails (ISS-133)", async () => {
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 1 }), makeNotif({ id: 2 })],
			total: 2,
			unread: 2,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		mockMarkAllRead.mockRejectedValueOnce(new Error("boom"));
		const wrapper = await mountPage();
		const badge = await badgeApi();

		const markAll = wrapper.findAll("button").find((b) => b.text().includes("全部标为已读"));
		expect(markAll).toBeDefined();
		await markAll?.trigger("click");
		await flushPromises();

		// Failure is surfaced instead of failing silently (ISS-133) — and with
		// its own copy (ISS-611: a failed mark-all must not read as a failed
		// inbox load), plus a targeted Retry.
		expect(wrapper.text()).toContain("标记已读失败，请重试。");
		expect(wrapper.text()).toContain("重试");
		// ...unread count is untouched, rows stay unread, and the button is
		// enabled again so the reader can retry.
		expect(badge.unreadCount.value).toBe(2);
		const after = wrapper.findAll("button").find((b) => b.text().includes("全部标为已读"));
		expect(after?.attributes("disabled")).toBeUndefined();
		expect(wrapper.findAll("button").some((b) => b.text().includes("标为已读"))).toBe(true);
	});

	it("renders a localized network error when the inbox fetch fails (ISS-110)", async () => {
		mockFetch.mockRejectedValue(new Error("boom"));
		const wrapper = await mountPage();
		// The failure copy is a distinct notifications.loadFailed line (ISS-611),
		// not the generic common.errors.network — an inbox-load failure is not
		// the same as a failed mark-read/delete.
		expect(wrapper.text()).toContain("加载通知失败，请重试。");
		expect(mockLogout).not.toHaveBeenCalled();
		expect(mockReplace).not.toHaveBeenCalled();
		// A failed load must never masquerade as an empty inbox: the "no
		// notifications" empty state is suppressed while the error banner shows.
		expect(wrapper.text()).not.toContain("暂无通知");
	});

	it("logs an expired session out and redirects to login on a 401 (ISS-110)", async () => {
		mockFetch.mockRejectedValue({ statusCode: 401 });
		const wrapper = await mountPage();
		expect(mockLogout).toHaveBeenCalledTimes(1);
		expect(mockReplace).toHaveBeenCalledWith({
			path: "/login",
			query: { redirect: "/notifications" },
		});
		// No misleading network-error banner when the cause is an stale session.
		expect(wrapper.text()).not.toContain("网络错误，请稍后重试");
	});

	it("loads the preferences card: push/inbox on, email kinds off (DEC-171/DEC-197/DEC-201/DEC-322)", async () => {
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("通知偏好");
		expect(wrapper.text()).toContain("被提及");
		const switches = wrapper.findAll('button[role="switch"]');
		expect(switches).toHaveLength(10);
		// Five on-by-default in-app kinds (incl. reader_comment, round 365)…
		for (let i = 0; i < 5; i += 1) {
			expect(switches[i].attributes("aria-checked")).toBe("true");
		}
		// …then the five opt-in email kinds, all off.
		for (let i = 5; i < 10; i += 1) {
			expect(switches[i].attributes("aria-checked")).toBe("false");
		}
	});

	it("toggles an email kind on via updateReaderNotificationPref (DEC-197)", async () => {
		const wrapper = await mountPage();
		const switches = wrapper.findAll('button[role="switch"]');
		// Order: new_post, reply, thread_comment, mention, reader_comment,
		// email_new_post, email_reply, email_thread_comment, email_weekly_digest.
		await switches[5].trigger("click");
		await flushPromises();
		expect(mockUpdatePref).toHaveBeenCalledWith("email_new_post", true);
		expect(switches[5].attributes("aria-checked")).toBe("true");
		expect(switches[6].attributes("aria-checked")).toBe("false");
	});

	it("toggles the weekly digest on via updateReaderNotificationPref (DEC-201)", async () => {
		const wrapper = await mountPage();
		const switches = wrapper.findAll('button[role="switch"]');
		// Last toggle = the weekly-digest email opt-in, independent of per-event kinds.
		expect(wrapper.text()).toContain("每周精选");
		await switches[9].trigger("click");
		await flushPromises();
		expect(mockUpdatePref).toHaveBeenCalledWith("email_weekly_digest", true);
		expect(switches[9].attributes("aria-checked")).toBe("true");
		// Per-event email kinds stay off.
		expect(switches[8].attributes("aria-checked")).toBe("false");
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

	it("toggles the mention kind off and back on via updateReaderNotificationPref (DEC-322)", async () => {
		const wrapper = await mountPage();
		const switches = wrapper.findAll('button[role="switch"]');
		// Order: new_post, reply, thread_comment, mention.
		expect(wrapper.text()).toContain("被提及");
		await switches[3].trigger("click");
		await flushPromises();
		expect(mockUpdatePref).toHaveBeenCalledWith("mention", false);
		expect(switches[3].attributes("aria-checked")).toBe("false");
		await switches[3].trigger("click");
		await flushPromises();
		expect(mockUpdatePref).toHaveBeenCalledWith("mention", true);
		expect(switches[3].attributes("aria-checked")).toBe("true");
		// Sibling in-app kinds are untouched by the op-out.
		expect(switches[2].attributes("aria-checked")).toBe("true");
	});

	it("toggles the reader-follow kind off via updateReaderNotificationPref (round 365, DEC-403)", async () => {
		const wrapper = await mountPage();
		const switches = wrapper.findAll('button[role="switch"]');
		// reader_comment is the 5th in-app kind (index 4), right after mention.
		expect(wrapper.text()).toContain("关注读者的新评论");
		expect(switches[4].attributes("aria-checked")).toBe("true");
		await switches[4].trigger("click");
		await flushPromises();
		expect(mockUpdatePref).toHaveBeenCalledWith("reader_comment", false);
		expect(switches[4].attributes("aria-checked")).toBe("false");
		// Sibling in-app kinds are untouched by the opt-out.
		expect(switches[3].attributes("aria-checked")).toBe("true");
	});

	it("toggles the email copy for @-mentions (DEC-326)", async () => {
		const wrapper = await mountPage();
		const switches = wrapper.findAll('button[role="switch"]');
		// Order: ... email_new_post, email_reply, email_thread_comment,
		// email_mention, email_weekly_digest (reader_comment sits before the
		// email block, so email_mention moved to index 8).
		expect(wrapper.text()).toContain("邮件：被提及");
		expect(switches[8].attributes("aria-checked")).toBe("false");
		await switches[8].trigger("click");
		await flushPromises();
		expect(mockUpdatePref).toHaveBeenCalledWith("email_mention", true);
		expect(switches[8].attributes("aria-checked")).toBe("true");
		// The in-app mention toggle (index 3) is untouched — the channels are
		// independent.
		expect(switches[3].attributes("aria-checked")).toBe("true");
	});

	it("shows a per-row saving indicator on the touched toggle while the request is in flight (deep-dive finding)", async () => {
		// A bare disable (prefsSaving !== null) looked like the tap did nothing —
		// the touched row must surface that persistence is under way.
		let resolveUpdate: (v: ReaderNotificationPrefs) => void;
		const pending = new Promise<ReaderNotificationPrefs>((resolve) => {
			resolveUpdate = resolve;
		});
		mockUpdatePref.mockReturnValueOnce(pending);
		const wrapper = await mountPage();
		const switches = wrapper.findAll('button[role="switch"]');
		await switches[0].trigger("click");
		await flushPromises();

		// The row being saved shows the spinner; no other row does.
		const saving = wrapper.findAll('[data-testid="pref-saving"]');
		expect(saving).toHaveLength(1);

		resolveUpdate?.({
			new_post: false,
			reply: true,
			thread_comment: true,
			mention: true,
			email_new_post: false,
			email_reply: false,
			email_thread_comment: false,
			email_mention: false,
			email_weekly_digest: false,
		});
		await flushPromises();
		expect(wrapper.findAll('[data-testid="pref-saving"]')).toHaveLength(0);
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

	it("loads more pages when the inbox has more than one page (bounded reachability)", async () => {
		// One 100-row page hides older notifications forever unless the page can
		// page on — total_pages > 1 must surface a load-more affordance.
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 101 }), makeNotif({ id: 100 })],
			total: 150,
			unread: 2,
			page: 1,
			limit: 100,
			total_pages: 2,
		});
		const wrapper = await mountPage();
		const loadMore = wrapper.findAll("button").find((b) => b.text().includes("加载更多"));
		expect(loadMore).toBeDefined();

		// Clicking fetchs page 2 and appends to the existing rows (no duplicates,
		// newest-first preserved). The badge poll also refreshes from the server,
		// so assert the page-2 request happened AND the appended row renders.
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 1, title: "最旧的那条" })],
			total: 150,
			unread: 2,
			page: 2,
			limit: 100,
			total_pages: 2,
		});
		await loadMore?.trigger("click");
		await flushPromises();
		expect(mockFetch).toHaveBeenCalledWith(2, 100);
		expect(wrapper.text()).toContain("最旧的那条");
		// All loaded rows are present, and the (still older) page-3 affordance is gone.
		expect(wrapper.findAll("button").some((b) => b.text().includes("加载更多"))).toBe(false);
		expect(wrapper.text()).not.toContain("网络错误");
	});

	it("labels the load-more button as Retry when a page fails to load (survey finding)", async () => {
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 101 })],
			total: 150,
			unread: 1,
			page: 1,
			limit: 100,
			total_pages: 2,
		});
		const wrapper = await mountPage();
		const loadMore = wrapper.findAll("button").find((b) => b.text().includes("加载更多"));
		expect(loadMore).toBeDefined();

		// The next page fails — the button must read Retry (same handler already
		// re-runs), so the reader doesn't have to guess that clicking again retries.
		mockFetch.mockRejectedValueOnce(new Error("boom"));
		await loadMore?.trigger("click");
		await flushPromises();
		expect(wrapper.text()).toContain("网络错误，请稍后重试");
		const retry = wrapper.findAll("button").find((b) => b.text().includes("重试"));
		expect(retry).toBeDefined();
		expect(wrapper.findAll("button").some((b) => b.text().includes("加载更多"))).toBe(false);

		// Clicking Retry re-fetches page 2 and appends (bounded reachability kept).
		mockFetch.mockResolvedValueOnce({
			items: [makeNotif({ id: 1, title: "最旧的那条" })],
			total: 150,
			unread: 1,
			page: 2,
			limit: 100,
			total_pages: 2,
		});
		await retry?.trigger("click");
		await flushPromises();
		expect(mockFetch).toHaveBeenCalledWith(2, 100);
		expect(wrapper.text()).toContain("最旧的那条");
	});

	it("a stale page-2 loadMore cannot resurrect the unread count after mark-all (round 418 audit)", async () => {
		// Race: reader clicks 加载更多 then (before it resolves) 全部标为已读.
		// The mark-all commits first (unread → 0, button hides); the older
		// loadMore response then resolves with its pre-read server snapshot
		// (unread=2) and — without a guard — writes it back, resurrecting the
		// button until the next poll. The page's unread write must be dropped
		// when a local read mutation happened during the request.
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 1 }), makeNotif({ id: 2 })],
			total: 150,
			unread: 2,
			page: 1,
			limit: 100,
			total_pages: 2,
		});
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("全部标为已读");

		// Hold the page-2 load open (its response carries the stale unread=2).
		let releaseLoadMore!: (value: unknown) => void;
		mockFetch.mockImplementationOnce(
			() =>
				new Promise<unknown>((resolve) => {
					releaseLoadMore = resolve;
				}),
		);
		const loadMore = wrapper.findAll("button").find((b) => b.text().includes("加载更多"));
		await loadMore?.trigger("click");
		await flushPromises();

		// Mark ALL read while loadMore is in flight — resolves first.
		mockMarkAllRead.mockResolvedValue({ updated: 2 });
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 1, read: true }), makeNotif({ id: 2, read: true })],
			total: 150,
			unread: 0,
			page: 1,
			limit: 100,
			total_pages: 2,
		});
		const markAll = wrapper.findAll("button").find((b) => b.text().includes("全部标为已读"));
		await markAll?.trigger("click");
		await flushPromises();
		expect(wrapper.text()).not.toContain("全部标为已读");

		// The stale loadMore finally lands with its pre-read unread snapshot —
		// it must NOT resurrect the mark-all button (the count stays 0).
		releaseLoadMore({
			items: [
				makeNotif({ id: 1, read: true }),
				makeNotif({ id: 0, title: "旧页那条", read: true }),
			],
			total: 150,
			unread: 2,
			page: 2,
			limit: 100,
			total_pages: 2,
		});
		await flushPromises();
		expect(wrapper.text()).not.toContain("全部标为已读");
	});

	it("hides the load-more affordance when there is only one page", async () => {
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 101 })],
			total: 101,
			unread: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const wrapper = await mountPage();
		const loadMore = wrapper.findAll("button").find((b) => b.text().includes("加载更多"));
		expect(loadMore).toBeUndefined();
	});

	it("signs out mid-page: clears the inbox and redirects to /login (deep-dive finding)", async () => {
		mockFetch.mockResolvedValue({
			items: [makeNotif({ id: 5, title: "私有通知" })],
			total: 1,
			unread: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		mockFetchPrefs.mockResolvedValue({
			new_post: true,
			reply: true,
			thread_comment: true,
			mention: true,
			email_mention: false,
		});
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("私有通知");

		// Sign out from the header while on the inbox: the private rows must not
		// stay visible under a now-dead session, and the reader lands on /login
		// like the guest guard / stale-session path.
		isAuthenticated.value = false;
		await flushPromises();
		expect(mockReplace).toHaveBeenCalledWith({
			path: "/login",
			query: { redirect: "/notifications" },
		});
		expect(wrapper.text()).not.toContain("私有通知");
		expect(wrapper.text()).not.toContain("通知偏好");
	});

	it("deletes one notification row and updates the list and badge (DEC-312)", async () => {
		vi.stubGlobal("confirm", () => true);
		try {
			mockFetch.mockResolvedValue({
				items: [
					makeNotif({ id: 1, title: "第一条通知" }),
					makeNotif({ id: 2, title: "第二条通知" }),
				],
				total: 2,
				unread: 2,
				page: 1,
				limit: 100,
				total_pages: 1,
			});
			const wrapper = await mountPage();
			const badge = await badgeApi();
			expect(badge.unreadCount.value).toBe(2);

			// The per-row delete button lives outside the row's link/anchor
			// (sibling, like mark-read), so it is a real clickable button. There
			// are two rows → two delete controls (aria-label disambiguates).
			const delButtons = wrapper
				.findAll("button")
				.filter((b) => b.attributes("aria-label") === "删除这条通知");
			expect(delButtons.length).toBe(2);

			// Post-delete the badge re-fetches from the server like mark-read does
			// (KEEP the post-action server truth), so the next GET reflects the drop.
			mockFetch.mockResolvedValue({
				items: [makeNotif({ id: 2, title: "第二条通知" })],
				total: 1,
				unread: 1,
				page: 1,
				limit: 100,
				total_pages: 1,
			});

			await delButtons[0]?.trigger("click");
			await flushPromises();
			expect(mockDeleteRow).toHaveBeenCalledWith(1);

			// The row left the list and the unread badge dropped with it.
			expect(wrapper.text()).not.toContain("第一条通知");
			expect(wrapper.text()).toContain("第二条通知");
			expect(badge.unreadCount.value).toBe(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("keeps the row when the delete is not confirmed (round 396)", async () => {
		vi.stubGlobal("confirm", () => false);
		try {
			mockFetch.mockResolvedValue({
				items: [makeNotif({ id: 7, title: "第七条通知" })],
				total: 1,
				unread: 0,
				page: 1,
				limit: 100,
				total_pages: 1,
			});
			const wrapper = await mountPage();
			const del = wrapper
				.findAll("button")
				.find((b) => b.attributes("aria-label") === "删除这条通知");
			expect(del).toBeDefined();
			await del?.trigger("click");
			await flushPromises();
			// Declining the confirm: nothing was deleted, the row stays.
			expect(mockDeleteRow).not.toHaveBeenCalled();
			expect(wrapper.text()).toContain("第七条通知");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("surfaces a failure and keeps the row when deleting fails", async () => {
		vi.stubGlobal("confirm", () => true);
		try {
			mockFetch.mockResolvedValue({
				items: [makeNotif({ id: 7, title: "第七条通知" })],
				total: 1,
				unread: 0,
				page: 1,
				limit: 100,
				total_pages: 1,
			});
			mockDeleteRow.mockRejectedValueOnce(new Error("boom"));
			const wrapper = await mountPage();

			const del = wrapper
				.findAll("button")
				.find((b) => b.attributes("aria-label") === "删除这条通知");
			expect(del).toBeDefined();
			await del?.trigger("click");
			await flushPromises();

			// Failure is surfaced with its own delete-specific copy (ISS-611) +
			// a targeted Retry; the row stays, and the delete button is enabled
			// again for retry.
			expect(wrapper.text()).toContain("删除这条通知失败，请重试。");
			expect(wrapper.text()).toContain("第七条通知");
			expect(del?.attributes("disabled")).toBeUndefined();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("offers a retry on preference-load failure and reloads on click (deep-dive finding)", async () => {
		mockFetch.mockResolvedValue({
			items: [],
			total: 0,
			unread: 0,
			page: 1,
			limit: 100,
			total_pages: 0,
		});
		mockFetchPrefs.mockRejectedValueOnce(new Error("boom"));
		mockFetchPrefs.mockResolvedValue({
			new_post: true,
			reply: true,
			thread_comment: true,
			mention: true,
			email_mention: false,
		});
		const wrapper = await mountPage();
		expect(wrapper.findAll('button[role="switch"]')).toHaveLength(0);
		// The prefs card's failure hint now carries a retry affordance instead of
		// a dead end (deep-dive finding).
		const retry = wrapper.findAll("button").find((b) => b.text().includes("重试"));
		expect(retry).toBeDefined();
		await retry?.trigger("click");
		await flushPromises();
		expect(wrapper.findAll('button[role="switch"]')).toHaveLength(10);
		expect(wrapper.text()).not.toContain("网络错误");
	});
});
