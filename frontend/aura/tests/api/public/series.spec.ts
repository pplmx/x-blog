import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSeries, useSeriesBySlug } from "../../../api/public/series.ts";

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

	it("derives a nullable series path from a reactive slug getter", () => {
		let slug: string | null = null;
		useSeriesBySlug(() => slug);

		const path = queryCalls[0].path as () => string | null;
		expect(path()).toBeNull();
		slug = "nuxt-deep-dive";
		expect(path()).toBe("/api/series/nuxt-deep-dive");
	});
});
