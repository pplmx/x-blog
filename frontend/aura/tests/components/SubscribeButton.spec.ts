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
const init = vi.fn().mockResolvedValue(undefined);
const subscribe = vi.fn().mockResolvedValue(undefined);
const unsubscribe = vi.fn().mockResolvedValue(undefined);
const syncReaderBinding = vi.fn().mockResolvedValue(undefined);
vi.mock("~~/composables/usePushSubscription", () => ({
	usePushSubscription: () => ({ status, init, subscribe, unsubscribe, syncReaderBinding }),
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
});
