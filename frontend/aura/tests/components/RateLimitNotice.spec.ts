/**
 * RateLimitNotice banner tests (round 212).
 *
 * The banner renders via the app-wide useRateLimitNotice singleton: hidden by
 * default, appears when a 429 flips the flag, and hides on explicit dismiss.
 * It must NOT claim role="status" — the app has other role=status live regions
 * (e.g. the resume chip) and an app-wide banner occupying that generic role
 * breaks strict-mode locators (e2e finding, round 215); it stays announced via
 * aria-live="polite" only.
 */
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";

import RateLimitNotice from "../../components/RateLimitNotice.vue";
import { useRateLimitNotice } from "../../composables/useRateLimitNotice";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
};

let wrapper: VueWrapper | undefined;

function mountBanner() {
	wrapper = mount(RateLimitNotice, {
		global: { stubs },
		attachTo: document.body,
	});
}

function bannerExists(): boolean {
	return document.body.querySelector('[aria-live="polite"]') !== null;
}

afterEach(async () => {
	useRateLimitNotice().dismiss();
	if (wrapper) {
		wrapper.unmount();
		wrapper = undefined;
	}
	await nextTick();
	document.body.innerHTML = "";
});

describe("RateLimitNotice", () => {
	it("is not rendered while no 429 has fired", () => {
		mountBanner();
		expect(bannerExists()).toBe(false);
	});

	it("appears when the rate-limit flag is active", async () => {
		mountBanner();
		useRateLimitNotice().show();
		await nextTick();
		expect(bannerExists()).toBe(true);
	});

	it("does not claim the generic status role (avoids strict-mode collisions)", async () => {
		mountBanner();
		useRateLimitNotice().show();
		await nextTick();
		expect(document.body.querySelector('[role="status"]')).toBe(null);
	});

	it("dismiss button hides the banner", async () => {
		mountBanner();
		useRateLimitNotice().show();
		await nextTick();
		const button = document.body.querySelector('[aria-live="polite"] button');
		expect(button).not.toBe(null);

		(button as HTMLButtonElement).click();
		await nextTick();

		expect(bannerExists()).toBe(false);
	});
});
