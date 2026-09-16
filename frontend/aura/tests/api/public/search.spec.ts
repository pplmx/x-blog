import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";

import { useCommentSearch } from "../../../api/public/search.ts";

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
	vi.stubGlobal("$fetch", vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("useCommentSearch (round 366, DEC-405)", () => {
	it("requests the comment search endpoint with q and pagination", () => {
		useCommentSearch({ q: "42", page: 2, limit: 10 });

		expect(queryCalls).toHaveLength(1);
		const path = queryCalls[0].path as () => string;
		expect(path()).toBe("/api/search/comments?q=42&page=2&limit=10");
	});

	it("re-builds the URL reactively when params change", () => {
		let q = "nuxt";
		useCommentSearch(() => ({ q, page: 1, limit: 20 }));

		const path = queryCalls[0].path as () => string;
		expect(path()).toBe("/api/search/comments?q=nuxt&page=1&limit=20");
		q = "评论";
		expect(path()).toBe("/api/search/comments?q=%E8%AF%84%E8%AE%BA&page=1&limit=20");
	});

	it("accepts a reactive params object (Ref) as the source", () => {
		useCommentSearch(ref({ q: "edge case" }), { server: true });

		const path = queryCalls[0].path as () => string;
		expect(path()).toBe("/api/search/comments?q=edge+case");
		expect(queryCalls[0].options.server).toBe(true);
	});

	it("omits undefined params from the URL", () => {
		useCommentSearch({ q: "found", page: undefined, limit: undefined });

		const path = queryCalls[0].path as () => string;
		expect(path()).toBe("/api/search/comments?q=found");
	});
});
