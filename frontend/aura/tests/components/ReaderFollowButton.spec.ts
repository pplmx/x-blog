/**
 * ReaderFollowButton component tests (reader-to-reader follow, round 365 /
 * DEC-403).
 *
 * The profile-header follow control: shows every visitor the public follower
 * count, renders a Follow/Following toggle only for a signed-in reader who is
 * not viewing their own profile, and seeds its state from the profile payload
 * (no follow-state GET — the profile already returns is_following). Click toggles
 * the follow and bumps the count off the server-confirmed result. Dead-session
 * 401s drop the expired token and show the sign-in prompt (round-300 guard,
 * mirrors AuthorFollowButton).
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Interpolate {count} so tests can assert the visible follower number.
const t = vi.fn((key: string, params?: Record<string, string | number>) =>
	params ? `${key}:${String(params.count ?? params.date ?? "")}` : key,
);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));

const { mockFollow, mockUnfollow } = vi.hoisted(() => ({
	mockFollow: vi.fn(),
	mockUnfollow: vi.fn(),
}));
vi.mock("~~/api/reader/follows", () => ({
	followReader: mockFollow,
	unfollowReader: mockUnfollow,
}));

import ReaderFollowButton from "../../components/ReaderFollowButton.vue";

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

const nuxtLinkStub = {
	name: "NuxtLink",
	template: '<a :href="to"><slot /></a>',
	props: ["to"],
};

let wrapper: ReturnType<typeof mount> | undefined;

async function mountButton({
	readerId = 5,
	initialFollowing = false,
	initialFollowerCount = 3,
} = {}) {
	wrapper = mount(ReaderFollowButton, {
		props: { readerId, initialFollowing, initialFollowerCount },
		global: { stubs: { Icon: iconStub, NuxtLink: nuxtLinkStub } },
	});
	await flushPromises();
	return wrapper;
}

function btn(w: ReturnType<typeof mount>, key: string) {
	return w.findAll("button").find((b) => b.text() === key);
}

function countLabel(w: ReturnType<typeof mount>) {
	return w.find('[data-testid="icon"]')?.element.parentElement?.textContent?.trim();
}

/** Sign in a reader (localStorage reader_token) with an optional profile. */
function signIn(profile?: { id?: number }) {
	localStorage.setItem("reader_token", "reader-jwt");
	if (profile) localStorage.setItem("reader_profile", JSON.stringify(profile));
}

function staleSessionError() {
	return {
		response: { status: 401, _data: { detail: "Could not validate credentials" } },
	};
}

describe("ReaderFollowButton", () => {
	afterEach(() => {
		// Unmount the previous wrapper: the watch holds the module-level
		// `signedIn` ref, so a still-mounted prior instance would refire its
		// state when the next test flips reader_token (leaked-watcher class).
		wrapper?.unmount();
		wrapper = undefined;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
	});

	it("shows every visitor the follower count and renders no button for guests", async () => {
		const w = await mountButton();
		expect(countLabel(w)).toContain("readerProfile.followerCountMany:3");
		expect(w.find("button").exists()).toBe(false);
		expect(mockFollow).not.toHaveBeenCalled();
		expect(mockUnfollow).not.toHaveBeenCalled();
	});

	it("shows the singular count label for a single follower", async () => {
		const w = await mountButton({ initialFollowerCount: 1 });
		expect(countLabel(w)).toContain("readerProfile.followerCountOne:1");
	});

	it("follows the reader on click and bumps the count (Follow → Following)", async () => {
		signIn();
		mockFollow.mockResolvedValue({
			reader_id: 5,
			display_name: "Riki",
			following: true,
			notify: true,
		});
		const w = await mountButton();
		expect(countLabel(w)).toContain(":3");
		await btn(w, "readerProfile.follow")?.trigger("click");
		await flushPromises();
		expect(mockFollow).toHaveBeenCalledWith(5);
		expect(btn(w, "readerProfile.following")?.attributes("aria-pressed")).toBe("true");
		expect(countLabel(w)).toContain(":4");
	});

	it("seeds the already-following state from the profile and unfollows back down", async () => {
		signIn();
		mockUnfollow.mockResolvedValue(null);
		const w = await mountButton({ initialFollowing: true, initialFollowerCount: 9 });
		expect(btn(w, "readerProfile.following")?.attributes("aria-pressed")).toBe("true");
		expect(countLabel(w)).toContain(":9");
		await btn(w, "readerProfile.following")?.trigger("click");
		await flushPromises();
		expect(mockUnfollow).toHaveBeenCalledWith(5);
		expect(btn(w, "readerProfile.follow")?.exists()).toBe(true);
		expect(countLabel(w)).toContain(":8");
	});

	it("renders no follow button on the reader's own profile", async () => {
		signIn({ id: 5 }); // viewer IS reader 5
		const w = await mountButton();
		expect(w.find("button").exists()).toBe(false);
		expect(countLabel(w)).toContain("readerProfile.followerCountMany:3");
	});

	it("shows a follow button for a signed-in reader viewing someone else", async () => {
		signIn({ id: 99 }); // signed in, but NOT reader 5
		const w = await mountButton();
		expect(btn(w, "readerProfile.follow")?.exists()).toBe(true);
	});

	it("keeps the un-followed state and shows the error bubble when the follow fails", async () => {
		signIn();
		mockFollow.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await btn(w, "readerProfile.follow")?.trigger("click");
		await flushPromises();
		expect(btn(w, "readerProfile.follow")?.exists()).toBe(true);
		expect(w.find('[role="status"]').exists()).toBe(true);
		expect(w.text()).toContain("readerProfile.followFailed");
	});

	it("drops the dead session and shows the sign-in prompt instead of a generic failure", async () => {
		signIn();
		mockFollow.mockRejectedValue(staleSessionError());
		const w = await mountButton();
		await btn(w, "readerProfile.follow")?.trigger("click");
		await flushPromises();

		// The dead token is dropped → the control flips to guest…
		expect(w.find("button").exists()).toBe(false);
		// …and the session-expired prompt (with a way back to sign-in) shows.
		expect(w.text()).toContain("common.sessionExpired");
		expect(w.find('a[href="/login"]').exists()).toBe(true);
		expect(w.find('[role="status"]').exists()).toBe(false);
	});
});
