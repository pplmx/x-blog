/**
 * Table of Contents (TOC) composable tests
 *
 * Tests extractToc() — heading extraction from HTML strings, slug generation,
 * tag stripping, and edge cases.
 */

import { describe, expect, it } from "vitest";

import { extractToc, useToc } from "../../composables/useToc";

describe("extractToc", () => {
	it("returns empty array for empty input", () => {
		expect(extractToc("")).toEqual([]);
	});

	it("returns empty array for null/undefined input", () => {
		expect(extractToc(null as unknown as string)).toEqual([]);
	});

	it("extracts h1 headings", () => {
		const html = "<h1>Hello World</h1>";
		const result = extractToc(html);
		expect(result).toHaveLength(1);
		expect(result[0].level).toBe(1);
		expect(result[0].text).toBe("Hello World");
		expect(result[0].id).toBe("hello-world");
	});

	it("extracts headings h1 through h6", () => {
		const html = "<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>";
		const result = extractToc(html);
		expect(result).toHaveLength(6);
		expect(result.map((r) => r.level)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it("preserves heading order", () => {
		const html = "<h2>Second</h2><h1>First</h1><h3>Third</h3>";
		const result = extractToc(html);
		expect(result.map((r) => r.text)).toEqual(["Second", "First", "Third"]);
	});

	it("strips HTML tags from heading text", () => {
		const html = "<h1>Hello <strong>bold</strong> World</h1>";
		const result = extractToc(html);
		expect(result[0].text).toBe("Hello bold World");
	});

	it("generates URL-safe slugs", () => {
		const html = "<h1>Hello, World! How are you?</h1>";
		const result = extractToc(html);
		expect(result[0].id).toBe("hello-world-how-are-you");
	});

	it("handles headings with extra attributes", () => {
		const html = '<h1 id="custom" class="title">Hello</h1>';
		const result = extractToc(html);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("Hello");
		expect(result[0].level).toBe(1);
	});

	it("skips headings with empty text after stripping tags", () => {
		const html = "<h1></h1><h2>Real</h2><h3>  </h3>";
		const result = extractToc(html);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("Real");
	});

	it("handles paragraphs between headings", () => {
		const html = "<p>Intro text</p><h1>Title</h1><p>Body</p><h2>Subtitle</h2>";
		const result = extractToc(html);
		expect(result).toHaveLength(2);
		expect(result[0].text).toBe("Title");
		expect(result[1].text).toBe("Subtitle");
	});

	it("returns empty array for HTML with no headings", () => {
		const html = "<p>Just a paragraph</p><div>Some content</div>";
		expect(extractToc(html)).toEqual([]);
	});

	it("handles multiple headings in sequence", () => {
		const html = "<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4>";
		const result = extractToc(html);
		expect(result).toHaveLength(4);
		expect(result[0].id).toBe("a");
		expect(result[1].id).toBe("b");
		expect(result[2].id).toBe("c");
		expect(result[3].id).toBe("d");
	});

	it("preserves CJK headings instead of collapsing to an empty id (RIL TASK-097, ISS-077)", () => {
		const html = "<h1>中文标题</h1><h2>Python 入门指南</h2>";
		const result = extractToc(html);
		expect(result).toHaveLength(2);
		// Empty id broke TOC anchors (href="#") + duplicate v-for keys before.
		expect(result[0].id).not.toBe("");
		expect(result[0].id).toBe("中文标题");
		expect(result[0].text).toBe("中文标题");
		expect(result[1].id).toBe("python-入门指南");
	});

	it("produces unique ids for distinct CJK headings (no empty-key collision)", () => {
		const html = "<h2>简介</h2><h2>安装</h2>";
		const result = extractToc(html);
		expect(result[0].id).toBe("简介");
		expect(result[1].id).toBe("安装");
		expect(new Set(result.map((r) => r.id)).size).toBe(2);
	});
});

describe("useToc", () => {
	it("accepts a plain string", () => {
		const { toc } = useToc("<h1>Hello</h1><h2>World</h2>");
		expect(toc.value).toHaveLength(2);
		expect(toc.value[0].text).toBe("Hello");
	});

	it("accepts a reactive ref ({ value })", () => {
		const ref = { value: "<h1>Reactive</h1><h2>Content</h2>" };
		const { toc } = useToc(ref);
		expect(toc.value).toHaveLength(2);
		expect(toc.value[0].text).toBe("Reactive");
		expect(toc.value[1].level).toBe(2);
	});
});

it("disambiguates duplicate heading text with -1/-2 suffixes (GitHub-style)", () => {
	const html = "<h2>前言</h2><h2>前言</h2><h2>安装</h2><h2>前言</h2>";
	const result = extractToc(html);
	expect(result.map((r) => r.id)).toEqual(["前言", "前言-1", "安装", "前言-2"]);
	// Every id stays unique so TOC anchors resolve to distinct sections.
	expect(new Set(result.map((r) => r.id)).size).toBe(result.length);
});

it("keeps distinct headings' ids unchanged when there is no duplicate", () => {
	const html = "<h1>简介</h1><h2>安装</h2>";
	expect(extractToc(html).map((r) => r.id)).toEqual(["简介", "安装"]);
});
