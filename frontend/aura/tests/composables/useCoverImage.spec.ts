/**
 * Tests for the algorithmic SVG cover generator.
 *
 * Regression for RIL TASK-112: a post title containing XML metacharacters (
 * & < > ) must be escaped before it is interpolated into the SVG text node,
 * otherwise the data-URI <img> cover produces XML-invalid SVG and fails to
 * render in some browsers.
 */

import { describe, expect, it } from "vitest";

import { coverImageSrc } from "../../composables/useCoverImage";

describe("coverImageSrc", () => {
	it("returns a data URI for a plain title", () => {
		const src = coverImageSrc("Hello World");
		expect(src.startsWith("data:image/svg+xml;charset=UTF-8,")).toBe(true);
	});

	it("escapes & < > in the title to keep the SVG XML well-formed (RIL TASK-112)", () => {
		// Short (under the 28-char truncation) so escaping is the only change.
		const src = coverImageSrc("Rock & <Roll>");
		const decoded = decodeURIComponent(src.split(",")[1]);
		expect(decoded).toContain("Rock &amp; &lt;Roll&gt;");
		expect(decoded).not.toContain("<Roll>");
		expect(decoded).not.toContain("& "); // no bare ampersand
	});
});
