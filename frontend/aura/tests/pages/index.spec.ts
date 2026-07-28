import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

vi.stubGlobal("useRoute", () => ({ path: "/", query: {} }));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useSeo", vi.fn());
vi.stubGlobal("onMounted", (fn: any) => fn());
vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiUrl: "", siteUrl: "http://localhost:3000" } }));
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("useFetch", vi.fn());
vi.stubGlobal("$fetch", vi.fn());

vi.mock("../../composables/useApi", () => ({
	usePosts: () => ({
		data: ref(null),
		pending: ref(false),
		error: ref(null),
		refresh: vi.fn(),
	}),
	usePopularPosts: () => ({
		data: ref([]),
	}),
}));

describe("Index Page", () => {
	it("page module loads successfully", async () => {
		const mod = await import("../../app/pages/index.vue");
		expect(mod).toBeDefined();
		expect(mod.default).toBeDefined();
	});
});
