/**
 * ThreadSubscribeButton component tests (DEC-078, TASK-150).
 *
 * The "follow discussion" toggle on the comments section: only signed-in
 * readers see it; the follow state is loaded from /api/posts/{id}/subscription;
 * clicking follow first opts the browser into push (if needed) and then PUTs
 * the thread follow; clicking again DELETEs it. Push-blocked browsers get a
 * disabled button, and a permission that stays denied after requesting shows
 * a hint instead of a silent no-op follow.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));

const status = ref("idle");
const init = vi.fn().mockResolvedValue(undefined);
const subscribe = vi.fn().mockResolvedValue(undefined);
vi.mock("~~/composables/usePushSubscription", () => ({
	usePushSubscription: () => ({ status, init, subscribe }),
}));

const isAuthenticated = ref(false);
vi.mock("~~/composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated }),
}));

const { mockUsePostSubscription, mockSubscribeToPostThread, mockUnsubscribeFromPostThread } =
	vi.hoisted(() => ({
		mockUsePostSubscription: vi.fn(),
		mockSubscribeToPostThread: vi.fn(),
		mockUnsubscribeFromPostThread: vi.fn(),
	}));
vi.mock("~~/api/reader/subscriptions", () => ({
	usePostSubscription: mockUsePostSubscription,
	subscribeToPostThread: mockSubscribeToPostThread,
	unsubscribeFromPostThread: mockUnsubscribeFromPostThread,
}));

import ThreadSubscribeButton from "../../components/ThreadSubscribeButton.vue";

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

function mockStatus(subscribed: boolean) {
	const data = ref({ post_id: 1, subscribed });
	mockUsePostSubscription.mockResolvedValue({ data });
}

let wrapper: ReturnType<typeof mount> | undefined;
async function mountButton() {
	wrapper = mount(ThreadSubscribeButton, {
		props: { postId: 1 },
		global: { stubs: { Icon: iconStub } },
	});
	await flushPromises();
	return wrapper;
}

describe("ThreadSubscribeButton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		status.value = "idle";
		isAuthenticated.value = false;
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = undefined;
	});

	it("is hidden when nobody is signed in", async () => {
		const w = await mountButton();
		expect(w.find("button").exists()).toBe(false);
		// No follow-state fetch fires for anonymous visitors.
		expect(mockUsePostSubscription).not.toHaveBeenCalled();
	});

	it("initializes push and loads the follow state on mount when signed in", async () => {
		isAuthenticated.value = true;
		mockStatus(false);
		await mountButton();
		expect(init).toHaveBeenCalledOnce();
		expect(mockUsePostSubscription).toHaveBeenCalledWith(1);
		expect(wrapper?.text()).toContain("components.threadSubscribe.follow");
	});

	it("follows: opts into push first, then subscribes the thread", async () => {
		isAuthenticated.value = true;
		mockStatus(false);
		status.value = "idle";
		// The permission prompt resolves granted -> composable flips to
		// "subscribed", so the follow proceeds.
		subscribe.mockImplementation(() => {
			status.value = "subscribed";
			return Promise.resolve();
		});
		const w = await mountButton();
		mockSubscribeToPostThread.mockResolvedValue({ data: { post_id: 1, subscribed: true } });
		await w.find("button").trigger("click");
		await flushPromises();
		expect(subscribe).toHaveBeenCalledOnce();
		expect(mockSubscribeToPostThread).toHaveBeenCalledWith(1);
		expect(w.text()).toContain("components.threadSubscribe.unfollow");
	});

	it("skips push opt-in when the browser is already subscribed", async () => {
		isAuthenticated.value = true;
		mockStatus(false);
		status.value = "subscribed";
		const w = await mountButton();
		mockSubscribeToPostThread.mockResolvedValue({ data: { post_id: 1, subscribed: true } });
		await w.find("button").trigger("click");
		await flushPromises();
		expect(subscribe).not.toHaveBeenCalled();
		expect(mockSubscribeToPostThread).toHaveBeenCalledWith(1);
	});

	it("unfollows: deletes the thread follow without touching the device", async () => {
		isAuthenticated.value = true;
		mockStatus(true);
		const w = await mountButton();
		expect(w.text()).toContain("components.threadSubscribe.unfollow");
		await w.find("button").trigger("click");
		await flushPromises();
		expect(mockUnsubscribeFromPostThread).toHaveBeenCalledWith(1);
		expect(mockSubscribeToPostThread).not.toHaveBeenCalled();
		expect(w.text()).toContain("components.threadSubscribe.follow");
	});

	it("is disabled when push is blocked on this browser", async () => {
		isAuthenticated.value = true;
		mockStatus(false);
		status.value = "denied";
		const w = await mountButton();
		expect((w.find("button").attributes("disabled") ?? "") !== undefined).toBe(true);
	});

	it("shows a hint instead of following when push permission stays denied", async () => {
		isAuthenticated.value = true;
		mockStatus(false);
		status.value = "idle";
		// Permission requested but denied -> composable leaves status "denied".
		subscribe.mockImplementation(() => {
			status.value = "denied";
			return Promise.resolve();
		});
		const w = await mountButton();
		await w.find("button").trigger("click");
		await flushPromises();
		await nextTick();
		expect(subscribe).toHaveBeenCalledOnce();
		expect(mockSubscribeToPostThread).not.toHaveBeenCalled();
		expect(w.text()).toContain("components.threadSubscribe.blockedHint");
	});

	it("announces a failed follow with role=alert (not a silent no-op)", async () => {
		isAuthenticated.value = true;
		mockStatus(false);
		status.value = "subscribed";
		mockSubscribeToPostThread.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await w.find("button").trigger("click");
		await flushPromises();

		const alert = w.find('[role="alert"]');
		expect(alert.exists()).toBe(true);
		expect(alert.text()).toContain("components.threadSubscribe.error");
		// Busy clears once the failure settles.
		expect(w.find("button").attributes("aria-busy")).toBe("false");
	});

	it("shows the error (not 'blocked') when the push opt-in itself fails transiently", async () => {
		isAuthenticated.value = true;
		mockStatus(false);
		status.value = "idle";
		// A transient SW/backend hiccup during the push opt-in (NOT a permission
		// denial): the composable rethrows, so the thread button must surface
		// "error" — the pre-rethrow code mislabeled this as "blocked".
		subscribe.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await w.find("button").trigger("click");
		await flushPromises();

		expect(w.find('[role="alert"]').text()).toContain("components.threadSubscribe.error");
		expect(w.text()).not.toContain("components.threadSubscribe.blockedHint");
		subscribe.mockResolvedValue(undefined);
	});
});
