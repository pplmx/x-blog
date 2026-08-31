/**
 * TagFollowButton component tests (DEC-196, TASK-216).
 *
 * The inline tag-follow control attached to the post-page footer chips: only
 * signed-in readers see it; follow state is loaded through the shared
 * useTagFollowStore (one GET /api/reader/me/tag-follows for every chip on the
 * page); clicking follows/unfollows the tag and toggles new-post notifications,
 * mirroring the /tags page controls.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));

const { mockGet, mockFollow, mockSetNotify, mockUnfollow } = vi.hoisted(() => ({
	mockGet: vi.fn(),
	mockFollow: vi.fn(),
	mockSetNotify: vi.fn(),
	mockUnfollow: vi.fn(),
}));
vi.mock("~~/api/reader/follows", () => ({
	getReaderTagFollows: mockGet,
	followReaderTag: mockFollow,
	setTagFollowNotify: mockSetNotify,
	unfollowReaderTag: mockUnfollow,
}));

import TagFollowButton from "../../components/TagFollowButton.vue";
import { useTagFollowStore } from "../../composables/useTagFollowStore";

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

let wrapper: ReturnType<typeof mount> | undefined;
const store = useTagFollowStore();

async function mountButton() {
	wrapper = mount(TagFollowButton, {
		props: { tagId: 7, tagName: "rust" },
		global: { stubs: { Icon: iconStub } },
	});
	await flushPromises();
	return wrapper;
}

function followed(notify = true) {
	mockGet.mockResolvedValue({ items: [{ id: 7, name: "rust", notify }], total: 1 });
}

describe("TagFollowButton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		store.reset();
		localStorage.clear();
	});

	it("renders nothing for guests and never fetches follow state", async () => {
		const w = await mountButton();
		expect(w.find("button").exists()).toBe(false);
		expect(mockGet).not.toHaveBeenCalled();
	});

	it("loads follow state on mount for a signed-in reader", async () => {
		localStorage.setItem("reader_token", "tok-1");
		followed();
		const w = await mountButton();
		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(w.find('button[aria-label="rust tags.followingTitle"]').exists()).toBe(true);
		expect(w.find('button[aria-label="rust tags.notifyOn"]').exists()).toBe(true);
	});

	it("shares one list fetch across every tag chip on the page", async () => {
		localStorage.setItem("reader_token", "tok-1");
		followed();
		await mountButton();
		const second = mount(TagFollowButton, {
			props: { tagId: 8, tagName: "postgres" },
			global: { stubs: { Icon: iconStub } },
		});
		await flushPromises();
		await flushPromises();
		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(second.find('button[aria-label="postgres tags.followTitle"]').exists()).toBe(true);
	});

	it("follows a tag on click", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockResolvedValue({ tag_id: 7, tag_name: "rust", following: true, notify: true });
		const w = await mountButton();
		expect(w.find('button[aria-label="rust tags.followTitle"]').exists()).toBe(true);
		await w.find('button[aria-label="rust tags.followTitle"]').trigger("click");
		await flushPromises();
		expect(mockFollow).toHaveBeenCalledWith(7);
		expect(w.find('button[aria-label="rust tags.followingTitle"]').exists()).toBe(true);
	});

	it("toggles new-post notifications while following", async () => {
		localStorage.setItem("reader_token", "tok-1");
		followed();
		mockSetNotify.mockResolvedValue({
			tag_id: 7,
			tag_name: "rust",
			following: true,
			notify: false,
		});
		const w = await mountButton();
		await w.find('button[aria-label="rust tags.notifyOn"]').trigger("click");
		await flushPromises();
		expect(mockSetNotify).toHaveBeenCalledWith(7, false);
		expect(w.find('button[aria-label="rust tags.notifyOff"]').exists()).toBe(true);
	});

	it("unfollows when already following", async () => {
		localStorage.setItem("reader_token", "tok-1");
		followed();
		mockUnfollow.mockResolvedValue(null);
		const w = await mountButton();
		await w.find('button[aria-label="rust tags.followingTitle"]').trigger("click");
		await flushPromises();
		expect(mockUnfollow).toHaveBeenCalledWith(7);
		expect(w.find('button[aria-label="rust tags.followingTitle"]').exists()).toBe(false);
		expect(w.find('button[aria-label="rust tags.followTitle"]').exists()).toBe(true);
	});

	it("stays on the un-followed state when the load fails", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		expect(w.find('button[aria-label="rust tags.followTitle"]').exists()).toBe(true);
		expect(w.find('button[aria-label="rust tags.followingTitle"]').exists()).toBe(false);
	});

	it("keeps the chip consistent when the follow request fails", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await w.find('button[aria-label="rust tags.followTitle"]').trigger("click");
		await flushPromises();
		expect(mockFollow).toHaveBeenCalledWith(7);
		expect(w.find('button[aria-label="rust tags.followingTitle"]').exists()).toBe(false);
		expect(w.find('button[aria-label="rust tags.followTitle"]').exists()).toBe(true);
	});

	it("surfaces a transient error bubble when the follow fails (regression: silent no-op)", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await w.find('button[aria-label="rust tags.followTitle"]').trigger("click");
		await flushPromises();

		const bubble = w.find('[role="status"]');
		expect(bubble.exists()).toBe(true);
		expect(bubble.text()).toContain("tags.followFailed");
		// The chip itself stays in its pre-failure state (retryable).
		expect(w.find('button[aria-label="rust tags.followTitle"]').exists()).toBe(true);
	});

	it("exposes follow and notify state via aria-pressed", async () => {
		localStorage.setItem("reader_token", "tok-1");
		followed();
		const w = await mountButton();
		expect(w.find('button[aria-label="rust tags.followingTitle"]').attributes("aria-pressed")).toBe(
			"true",
		);
		expect(w.find('button[aria-label="rust tags.notifyOn"]').attributes("aria-pressed")).toBe(
			"true",
		);
	});
});
