/**
 * Scoped-feed catch-all path validation (server/routes/rss/[...path].ts).
 *
 * Regression test for the path-traversal hardening: the proxy forwards
 * `/rss/{path}` to a fixed backend, and the HTTP client normalises `..` /
 * extra `/` / `\` when it parses the constructed URL — so validating only the
 * first segment let `category/../../admin/...` escape the `/rss/` prefix and
 * reach arbitrary backend paths. `isScopedFeedPath` must accept only the
 * real scoped shapes ({category|series|authors}/{name}) and reject everything
 * else.
 */

import { describe, expect, it } from "vitest";

import { isScopedFeedPath } from "../../server/utils/scopedFeedPath";

describe("isScopedFeedPath", () => {
	it("accepts the three legitimate scoped feed shapes", () => {
		expect(isScopedFeedPath("category/技术.xml")).toBe(true);
		expect(isScopedFeedPath("series/my-series.xml")).toBe(true);
		expect(isScopedFeedPath("authors/42.xml")).toBe(true);
	});

	it("rejects dot-segment traversal that would escape the /rss/ prefix", () => {
		expect(isScopedFeedPath("category/../../admin/security")).toBe(false);
		expect(isScopedFeedPath("category/../admin")).toBe(false);
		expect(isScopedFeedPath("series/..//..//admin")).toBe(false);
		expect(isScopedFeedPath("authors/..%2f..%2fadmin")).toBe(false);
	});

	it("rejects backslash separators (Windows-style traversal)", () => {
		expect(isScopedFeedPath("category\\..\\..\\admin")).toBe(false);
		expect(isScopedFeedPath("category/name.xml\\admin")).toBe(false);
	});

	it("rejects unknown kinds, empty segments, and wrong segment counts", () => {
		expect(isScopedFeedPath("tags/foo.xml")).toBe(false);
		expect(isScopedFeedPath("admin/")).toBe(false);
		expect(isScopedFeedPath("/category/foo.xml")).toBe(false);
		expect(isScopedFeedPath("category/foo/bar.xml")).toBe(false);
		expect(isScopedFeedPath("category/")).toBe(false);
		expect(isScopedFeedPath("")).toBe(false);
		expect(isScopedFeedPath("category/foo.xml/")).toBe(false);
	});
});
