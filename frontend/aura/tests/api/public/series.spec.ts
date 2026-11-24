import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ref } from "vue";

import { useSeries, useSeriesBySlug } from "~~/api/public/series.ts";

let queryCalls: Array<{ path: unknown; options: Record<string, unknown> }>;

beforeEach(() => {
	queryCalls = [];
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "https://api.example.test" },
	}));
	vi.stubGlobal(
		"useFetch",
		vi.fn((path: unknown, options: Record<string, unknown> = {}) => {
			queryCalls.push({ path, options });
			return { data: null, error: null };
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("public series", () => {
	it("preserves the series list endpoint", () => {
		useSeries();

		expect(queryCalls[0].path).toBe("/api/series");
		expect(queryCalls[0].options.baseURL).toBe("https://api.example.test");
	});

	it("skips the series request until the slug has content", () => {
		const slug = ref<string | null>(null);
		useSeriesBySlug(() => slug.value);

		const enabled = queryCalls[0].options.enabled as { value: boolean };
		expect(enabled.value).toBe(false);
		slug.value = "   ";
		expect(enabled.value).toBe(false);
		slug.value = "nuxt-deep-dive";
		expect(enabled.value).toBe(true);
		const path = queryCalls[0].path as () => string;
		expect(path()).toBe("/api/series/nuxt-deep-dive");
	});
});
