/**
 * SubscribeButton component tests (DEC-055, TASK-118).
 *
 * Verifies the button's rendering per status (hidden when unsupported/
 * unconfigured, disabled when blocked, label/icon per state) and that clicks
 * dispatch subscribe/unsubscribe from the composable.
 */

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));

const status = ref("idle");
const pushError = ref(false);
const init = vi.fn().mockResolvedValue(undefined);
const subscribe = vi.fn().mockResolvedValue(undefined);
const unsubscribe = vi.fn().mockResolvedValue(undefined);
const syncReaderBinding = vi.fn().mockResolvedValue(undefined);
vi.mock("~~/composables/usePushSubscription", () => ({
	usePushSubscription: () => ({
		status,
		error: pushError,
		init,
		subscribe,
		unsubscribe,
		syncReaderBinding,
	}),
}));

const isAuthenticated = ref(false);
vi.mock("~~/composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated }),
}));

import SubscribeButton from "../../components/SubscribeButton.vue";

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

let wrapper: ReturnType<typeof mount> | undefined;
function mountButton() {
	wrapper = mount(SubscribeButton, {
		global: { stubs: { Icon: iconStub } },
	});
	return wrapper;
}

describe("SubscribeButton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		// Unmount so per-instance watchers (e.g. the isAuthenticated watch) don't
		// fire again on later tests mutating the shared refs.
		wrapper?.unmount();
		wrapper = undefined;
		isAuthenticated.value = false;
		pushError.value = false;
	});

	it("is hidden when the browser does not support push (unsupported)", () => {
		status.value = "unsupported";
		const wrapper = mountButton();
		expect(wrapper.find("button").exists()).toBe(false);
	});

	it("is hidden when the backend exposes no VAPID key (unconfigured)", () => {
		status.value = "unconfigured";
		const wrapper = mountButton();
		expect(wrapper.find("button").exists()).toBe(false);
	});

	it("calls init on mount", () => {
		status.value = "idle";
		mountButton();
		expect(init).toHaveBeenCalledOnce();
	});

	it("renders a subscribe bell when idle", () => {
		status.value = "idle";
		const wrapper = mountButton();
		const button = wrapper.get("button");
		expect(button.attributes("aria-label")).toBe("common.push.subscribe");
		expect(wrapper.get('[data-testid="icon"]').attributes("data-icon")).toBe("lucide:bell");
	});

	it("renders subscribed bell-ring and unsubscribes on click", async () => {
		status.value = "subscribed";
		const wrapper = mountButton();
		expect(wrapper.get("button").attributes("aria-label")).toBe("common.push.subscribed");
		expect(wrapper.get('[data-testid="icon"]').attributes("data-icon")).toBe("lucide:bell-ring");
		await wrapper.get("button").trigger("click");
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("subscribes on click when idle", async () => {
		status.value = "idle";
		const wrapper = mountButton();
		await wrapper.get("button").trigger("click");
		expect(subscribe).toHaveBeenCalledOnce();
		expect(unsubscribe).not.toHaveBeenCalled();
	});

	it("flashes a transient error bubble when a push failure is reported (ISS-215)", async () => {
		status.value = "idle";
		pushError.value = true;
		const wrapper = mountButton();
		await nextTick();

		const bubble = wrapper.find('[role="alert"]');
		expect(bubble.exists()).toBe(true);
		expect(bubble.text()).toContain("common.push.subscribeFailed");
		pushError.value = false;
		await nextTick();
		expect(wrapper.find('[role="alert"]').exists()).toBe(false);
	});

	it("is disabled when the browser has blocked notifications", () => {
		status.value = "denied";
		const wrapper = mountButton();
		const button = wrapper.get("button");
		expect(button.attributes("disabled")).toBeDefined();
		expect(button.attributes("aria-label")).toBe("common.push.denied");
		expect(wrapper.get('[data-testid="icon"]').attributes("data-icon")).toBe("lucide:bell-off");
	});

	it("renders a spinner icon while busy and ignores clicks", async () => {
		status.value = "subscribing";
		const wrapper = mountButton();
		expect(wrapper.get('[data-testid="icon"]').attributes("data-icon")).toBe("lucide:loader-2");
		expect(wrapper.get("button").attributes("disabled")).toBeDefined();
		await wrapper.get("button").trigger("click");
		expect(subscribe).not.toHaveBeenCalled();
	});

	it("advertises reply notifications in the tooltip when signed in (DEC-064)", () => {
		status.value = "idle";
		isAuthenticated.value = true;
		const wrapper = mountButton();
		expect(wrapper.get("button").attributes("title")).toBe(
			"common.push.subscribe · common.push.repliesIn",
		);
		// aria-label stays the base label (stable for assistive tech + e2e).
		expect(wrapper.get("button").attributes("aria-label")).toBe("common.push.subscribe");
	});

	it("does not advertise reply notifications when signed out", () => {
		status.value = "idle";
		isAuthenticated.value = false;
		const wrapper = mountButton();
		expect(wrapper.get("button").attributes("title")).toBe("common.push.subscribe");
	});

	it("re-stamps an existing subscription when a reader signs in", async () => {
		status.value = "subscribed";
		isAuthenticated.value = false;
		mountButton();
		expect(syncReaderBinding).not.toHaveBeenCalled();
		isAuthenticated.value = true;
		await nextTick();
		expect(syncReaderBinding).toHaveBeenCalledOnce();
	});

	it("re-stamps when a signed-in reader loads the page already subscribed (ISS-112)", async () => {
		// The reader signed in on a previous page-load (token persists in
		// localStorage) and the browser subscription already exists — the
		// false->true transition never happens, so the re-stamp must fire on
		// mount with both conditions already true. Without an immediate watch
		// this anonymous subscription stays reader_id NULL forever and keeps
		// receiving new_post pushes despite the reader's opt-out (DEC-171).
		status.value = "subscribed";
		isAuthenticated.value = true;
		mountButton();
		expect(syncReaderBinding).toHaveBeenCalledOnce();
	});

	it("shows the label text by default but hides it wide-only when compact (ISS-125/TASK-225)", async () => {
		// The header nav row is tight at xl (1280px) once a reader is signed
		// in (English), so the desktop nav renders the button compact and the
		// label surfaces only on very wide screens. Everywhere else — the
		// mobile menu especially (now shown below xl) — keeps the full text:
		// an unconditional `hidden 2xl:inline` would leave the mobile-menu
		// button icon-only forever, since the menu never reaches 2xl.
		// These mounts go through the shared `wrapper` slot so the afterEach
		// cleanup unmounts even if an assertion throws mid-test — a leaked
		// mounted instance's immediate watch would hiccup the following tests
		// by re-firing syncReaderBinding on their status transitions.
		status.value = "idle";
		wrapper = mount(SubscribeButton, {
			props: { compact: true },
			global: { stubs: { Icon: iconStub } },
		});
		expect(
			wrapper
				.findAll("span")
				.some((s) => s.text() === "common.push.subscribe" && s.classes().includes("hidden")),
		).toBe(true);
		wrapper.unmount();

		wrapper = mount(SubscribeButton, {
			global: { stubs: { Icon: iconStub } },
		});
		const labelSpan = wrapper.findAll("span").find((s) => s.text() === "common.push.subscribe");
		expect(labelSpan?.classes()).not.toContain("hidden");
		wrapper.unmount();
		wrapper = undefined;
	});

	it("re-stamps once init() reveals an existing subscription for a signed-in reader (ISS-112)", async () => {
		// On load, status starts "unsupported" until the async init() detects
		// the browser subscription — so an isAuthenticated-only watch (even
		// immediate) fires before the guard passes, then keeps silent once
		// status becomes "subscribed". The combined watch re-evaluates on the
		// status change, so the first moment both hold true triggers the bind.
		status.value = "unsupported";
		isAuthenticated.value = true;
		mountButton();
		expect(syncReaderBinding).not.toHaveBeenCalled();
		status.value = "subscribed"; // init() settled and found a subscription
		await nextTick();
		expect(syncReaderBinding).toHaveBeenCalledOnce();
	});
});
