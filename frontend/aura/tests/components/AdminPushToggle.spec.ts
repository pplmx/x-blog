/**
 * AdminPushToggle component tests (DEC-080, TASK-152).
 *
 * Verifies the admin moderation-alert toggle's rendering per status (always
 * present in the admin sidebar, disabled with an explanatory hint when
 * delivery is impossible — unsupported/unconfigured/denied — matching
 * ThreadSubscribeButton's never-a-silent-no-op gating) and that clicks
 * dispatch subscribe/unsubscribe from the composable.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));

const status = ref("idle");
const init = vi.fn().mockResolvedValue(undefined);
const subscribe = vi.fn().mockResolvedValue(undefined);
const unsubscribe = vi.fn().mockResolvedValue(undefined);
vi.mock("~~/composables/useAdminPushSubscription", () => ({
	useAdminPushSubscription: () => ({ status, init, subscribe, unsubscribe }),
}));

import AdminPushToggle from "../../components/AdminPushToggle.vue";

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

let wrapper: ReturnType<typeof mount> | undefined;
function mountToggle() {
	wrapper = mount(AdminPushToggle, {
		global: { stubs: { Icon: iconStub } },
	});
	return wrapper;
}

describe("AdminPushToggle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		wrapper?.unmount();
		wrapper = undefined;
		// clearAllMocks keeps a failure a specific test installed — restore the
		// default resolving implementations.
		subscribe.mockResolvedValue(undefined);
		unsubscribe.mockResolvedValue(undefined);
	});

	it("is disabled with a hint when the browser does not support push (unsupported)", () => {
		status.value = "unsupported";
		const wrapper = mountToggle();
		const button = wrapper.get("button");
		expect(button.attributes("disabled")).toBeDefined();
		expect(button.attributes("title")).toBe("admin.moderationPush.hint");
	});

	it("is disabled with a hint when the backend exposes no VAPID key (unconfigured)", () => {
		status.value = "unconfigured";
		const wrapper = mountToggle();
		const button = wrapper.get("button");
		expect(button.attributes("disabled")).toBeDefined();
		expect(button.attributes("title")).toBe("admin.moderationPush.hint");
		expect(wrapper.text()).toContain("admin.moderationPush.hint");
	});

	it("calls init on mount", () => {
		status.value = "idle";
		mountToggle();
		expect(init).toHaveBeenCalledOnce();
	});

	it("renders a subscribe bell when idle", () => {
		status.value = "idle";
		const wrapper = mountToggle();
		const button = wrapper.get("button");
		expect(button.attributes("aria-label")).toBe("admin.moderationPush.subscribe");
		expect(wrapper.get('[data-testid="icon"]').attributes("data-icon")).toBe("lucide:bell");
		// The hint explains what the alert does.
		expect(wrapper.text()).toContain("admin.moderationPush.hint");
	});

	it("renders subscribed bell-ring and unsubscribes on click", async () => {
		status.value = "subscribed";
		const wrapper = mountToggle();
		expect(wrapper.get("button").attributes("aria-label")).toBe("admin.moderationPush.subscribed");
		expect(wrapper.get('[data-testid="icon"]').attributes("data-icon")).toBe("lucide:bell-ring");
		await wrapper.get("button").trigger("click");
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("subscribes on click when idle", async () => {
		status.value = "idle";
		const wrapper = mountToggle();
		await wrapper.get("button").trigger("click");
		expect(subscribe).toHaveBeenCalledOnce();
		expect(unsubscribe).not.toHaveBeenCalled();
	});

	it("is disabled with an explanatory hint when the browser blocked notifications", () => {
		status.value = "denied";
		const wrapper = mountToggle();
		const button = wrapper.get("button");
		expect(button.attributes("disabled")).toBeDefined();
		expect(button.attributes("title")).toBe("admin.moderationPush.hint");
		expect(button.attributes("aria-label")).toBe("admin.moderationPush.denied");
		expect(wrapper.get('[data-testid="icon"]').attributes("data-icon")).toBe("lucide:bell-off");
	});

	it("renders a spinner icon while busy and ignores clicks", async () => {
		status.value = "subscribing";
		const wrapper = mountToggle();
		expect(wrapper.get('[data-testid="icon"]').attributes("data-icon")).toBe("lucide:loader-2");
		expect(wrapper.get("button").attributes("disabled")).toBeDefined();
		await wrapper.get("button").trigger("click");
		expect(subscribe).not.toHaveBeenCalled();
	});

	it("flashes a transient error line when the subscribe rejects (ISS-215)", async () => {
		status.value = "idle";
		subscribe.mockRejectedValue(new Error("network"));
		const wrapper = mountToggle();
		await wrapper.get("button").trigger("click");
		await flushPromises();

		const alert = wrapper.find('[role="alert"]');
		expect(alert.exists()).toBe(true);
		expect(alert.text()).toContain("admin.moderationPush.subscribeFailed");
	});
});
