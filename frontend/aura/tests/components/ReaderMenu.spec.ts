/**
 * ReaderMenu component tests (round 382, top-nav "My" menu).
 *
 * Verifies the "我的" avatar dropdown that replaced the signed-in reader's flat
 * nav links: the avatar trigger + unread badge, the mini profile header, the
 * public-profile / personal links, outside-click / Escape close + focus
 * restore, and sign-out dispatch.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import type { ReaderProfile } from "../../api/reader/auth";

// t returns the key so assertions pin labels to their source key; the layout
// test (untampered useLang, zh) covers the real locale strings.
const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));

const unreadCount = ref(0);
vi.mock("~~/composables/useNotificationBadge", () => ({
	useNotificationBadge: () => ({
		unreadCount,
		refresh: vi.fn(),
		startPolling: vi.fn(),
		stopPolling: vi.fn(),
	}),
}));

const reader = ref<ReaderProfile | null>(null);
const logout = vi.fn();
vi.mock("~~/composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated: ref(true), reader, logout }),
}));

vi.mock("~~/utils/focusRing", () => ({
	nextFocusable: vi.fn(() => null),
}));

import ReaderMenu from "../../components/ReaderMenu.vue";

const links = [
	{ to: "/bookmarks", labelKey: "reader.nav.bookmarks", icon: "lucide:bookmark" },
	{ to: "/history", labelKey: "reader.nav.history", icon: "lucide:history" },
	{ to: "/comments", labelKey: "reader.nav.comments", icon: "lucide:message-square" },
	{ to: "/liked", labelKey: "reader.nav.liked", icon: "lucide:heart" },
	{ to: "/follows", labelKey: "reader.nav.follows", icon: "lucide:rss" },
	{
		to: "/notifications",
		labelKey: "reader.nav.notifications",
		icon: "lucide:bell",
		badge: "unread",
	},
];

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

const nuxtLinkStub = {
	name: "NuxtLink",
	template: '<a :href="to"><slot/></a>',
	props: ["to"],
};

let wrapper: ReturnType<typeof mount> | undefined;
function mountMenu(attachTo?: HTMLElement) {
	wrapper = mount(ReaderMenu, {
		props: { links },
		attachTo,
		global: { stubs: { NuxtLink: nuxtLinkStub, Icon: iconStub } },
	});
	return wrapper;
}

/** Open the dropdown the way a reader does: click the avatar trigger. */
async function openMenu(w: ReturnType<typeof mount>) {
	const trigger = w.find('button[aria-label="reader.nav.groupMy"]');
	await trigger.trigger("click");
	await nextTick();
	await flushPromises();
}

describe("ReaderMenu", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		wrapper?.unmount();
		wrapper = undefined;
		reader.value = null;
		unreadCount.value = 0;
		document.body.innerHTML = "";
	});

	it("renders a closed avatar trigger", () => {
		const wrapper = mountMenu();
		const trigger = wrapper.find('button[aria-label="reader.nav.groupMy"]');
		expect(trigger.exists()).toBe(true);
		expect(trigger.attributes("aria-haspopup")).toBe("menu");
		expect(trigger.attributes("aria-expanded")).toBe("false");
		// Menu is closed: no menuitems yet.
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});

	it("opens the menu on click with the mini profile, personal links and sign-out", async () => {
		reader.value = {
			id: 42,
			email: "dev@x.blog",
			display_name: "Deev",
			bio: null,
			avatar_url: null,
			public_likes: false,
			public_bookmarks: false,
			two_factor_enabled: false,
			created_at: null,
		};
		const wrapper = mountMenu();
		await openMenu(wrapper);

		expect(wrapper.find('[role="menu"]').exists()).toBe(true);
		// Mini profile header → /account, showing the display name + email.
		const accountHeader = wrapper.find('a[href="/account"]');
		expect(accountHeader.exists()).toBe(true);
		expect(accountHeader.text()).toContain("Deev");
		expect(accountHeader.text()).toContain("dev@x.blog");
		// Public profile link /readers/{id}.
		expect(wrapper.find('a[href="/readers/42"]').exists()).toBe(true);
		// Every personal link is present.
		for (const link of links) {
			expect(wrapper.find(`a[href="${link.to}"]`).exists()).toBe(true);
		}
		// Sign-out is a button (not a link).
		const signOut = wrapper
			.findAll('[role="menuitem"]')
			.find((el) => el.element.tagName === "BUTTON" && el.text().includes("reader.nav.signOut"));
		expect(signOut).toBeDefined();
	});

	it("hides the public-profile link when the reader profile has no id", async () => {
		const wrapper = mountMenu();
		await openMenu(wrapper);
		expect(wrapper.find('a[href^="/readers/"]').exists()).toBe(false);
	});

	it("shows the unread badge on the avatar and the notifications row", async () => {
		unreadCount.value = 5;
		const wrapper = mountMenu();
		// Avatar badge is visible while the menu is closed.
		const avatarBadge = wrapper.find('button [role="status"]');
		expect(avatarBadge.exists()).toBe(true);
		expect(avatarBadge.text()).toBe("5");

		await openMenu(wrapper);
		const rowBadge = wrapper.find('a[href="/notifications"] [role="status"]');
		expect(rowBadge.exists()).toBe(true);
		expect(rowBadge.text()).toBe("5");
	});

	it("caps the unread count at 99+", async () => {
		unreadCount.value = 150;
		const wrapper = mountMenu();
		expect(wrapper.find('button [role="status"]').text()).toBe("99+");
	});

	it("renders no avatar badge and no row badge when the count is zero", async () => {
		const wrapper = mountMenu();
		expect(wrapper.find('button [role="status"]').exists()).toBe(false);
		await openMenu(wrapper);
		expect(wrapper.find('a[href="/notifications"] [role="status"]').exists()).toBe(false);
	});

	it("closes the menu when a link is selected", async () => {
		const wrapper = mountMenu();
		await openMenu(wrapper);
		await wrapper.find('a[href="/history"]').trigger("click");
		await nextTick();
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});

	it("signs out from the menu and closes it", async () => {
		const wrapper = mountMenu();
		await openMenu(wrapper);
		const signOut = wrapper
			.findAll('[role="menuitem"]')
			.find((el) => el.element.tagName === "BUTTON" && el.text().includes("reader.nav.signOut"));
		expect(signOut).toBeDefined();
		if (signOut) await signOut.trigger("click");
		await nextTick();
		expect(logout).toHaveBeenCalledOnce();
		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
	});

	describe("keyboard + pointer contract", () => {
		// These assert real focus movement, so the component must be attached.
		it("closes on outside click", async () => {
			const root = document.createElement("div");
			document.body.appendChild(root);
			const wrapper = mountMenu(root);
			await openMenu(wrapper);
			// Clicking outside the root (a bare body click) closes the menu.
			document.body.click();
			await nextTick();
			expect(wrapper.find('[role="menu"]').exists()).toBe(false);
		});

		it("moves focus into the menu on open and restores it to the trigger on Escape", async () => {
			const root = document.createElement("div");
			document.body.appendChild(root);
			const wrapper = mountMenu(root);
			const trigger = wrapper.find('button[aria-label="reader.nav.groupMy"]');
			await trigger.trigger("click");
			await nextTick();
			expect(document.activeElement).toBe(wrapper.find('[role="menuitem"]').element);

			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
			await nextTick();
			expect(wrapper.find('[role="menu"]').exists()).toBe(false);
			expect(document.activeElement).toBe(trigger.element);
		});

		it("roams menu focus with ArrowDown", async () => {
			const root = document.createElement("div");
			document.body.appendChild(root);
			const wrapper = mountMenu(root);
			await openMenu(wrapper);
			const items = wrapper.findAll('[role="menuitem"]');
			expect(items.length).toBeGreaterThan(1);

			document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
			await nextTick();
			expect(document.activeElement).toBe(items[1].element);
		});
	});
});
