import { beforeAll, describe, expect, it } from "vitest";
import {
	regexSanitize,
	type Segment,
	sanitizeHtml,
	sanitizeUrl,
	useMarkdown,
	useMarkdownSanitised,
} from "~/composables/useMarkdown";

describe("useMarkdown debug", () => {
	it("HTML", () => {
		const r = useMarkdown("<p>Hello</p>");
		console.log("HTML segments:", JSON.stringify(r.segments));
		expect(r.segments.length).toBe(1);
	});

	it("code block", () => {
		const r = useMarkdown("```ts\nconst x = 42;\n```");
		console.log("Code segments:", JSON.stringify(r.segments));
		expect(r.segments.length).toBe(1);
	});

	it("image", () => {
		const r = useMarkdown('<img src="test.png" alt="img" />');
		console.log("Image segments:", JSON.stringify(r.segments));
		expect(r.segments.length).toBe(1);
	});

	it("mixed", () => {
		const r = useMarkdown("<p>Before</p>\n```ts\ncode\n```\n<p>After</p>");
		console.log("Mixed segments:", JSON.stringify(r.segments));
		expect(r.segments.length).toBe(3);
	});
});

describe("useMarkdown features", () => {
	it("extracts mermaid blocks", () => {
		const r = useMarkdown("```mermaid\nflowchart LR\nA-->B\n```");
		expect(r.segments).toHaveLength(1);
		expect(r.segments[0].type).toBe("mermaid");
	});

	it("extracts images with alt text", () => {
		const r = useMarkdown('<img src="/img.png" alt="My Image" />');
		expect(r.segments).toHaveLength(1);
		expect(r.segments[0].type).toBe("image");
		expect(r.segments[0].alt).toBe("My Image");
	});

	it("leaves images without src intact", () => {
		const r = useMarkdown('<img alt="no src" />');
		expect(r.segments).toHaveLength(1);
		expect(r.segments[0].type).toBe("html");
	});

	it("extracts mermaid before code blocks", () => {
		const r = useMarkdown("```mermaid\nflow\n```\n```ts\ncode\n```");
		expect(r.segments).toHaveLength(2);
		expect(r.segments[0].type).toBe("mermaid");
		expect(r.segments[1].type).toBe("code");
	});

	it("does not extract $ inside code blocks as math", () => {
		const r = useMarkdown("```js\nconst price = $100;\n```\n\nMath: $x^2$");
		expect(r.segments.some((s) => s.type === "code")).toBe(true);
		expect(r.segments.some((s) => s.type === "math")).toBe(true);
		// The code segment should contain the $ sign, not have it consumed
		const codeSeg = r.segments.find((s) => s.type === "code") as any;
		expect(codeSeg.code).toContain("$100");
		// The math segment should only be the actual math formula
		const mathSeg = r.segments.find((s) => s.type === "math") as any;
		expect(mathSeg.formula).toBe("x^2");
	});

	it("does not extract $$ inside code blocks as display math", () => {
		const r = useMarkdown("```py\n# Formula: $$a^2 + b^2 = c^2$$\n```\n\nDisplay: $$x = y$$");
		expect(r.segments.some((s) => s.type === "code")).toBe(true);
		expect(r.segments.some((s) => s.type === "math")).toBe(true);
		const codeSeg = r.segments.find((s) => s.type === "code") as any;
		expect(codeSeg.code).toContain("$$a^2 + b^2 = c^2$$");
		const mathSeg = r.segments.find((s) => s.type === "math") as any;
		expect(mathSeg.formula).toBe("x = y");
		expect(mathSeg.displayMode).toBe(true);
	});

	it("extracts inline math", () => {
		const r = useMarkdown("The formula is $E = mc^2$");
		const mathSeg = r.segments.find((s) => s.type === "math") as any;
		expect(mathSeg).toBeDefined();
		expect(mathSeg.formula).toBe("E = mc^2");
		expect(mathSeg.displayMode).toBe(false);
	});

	it("extracts single-line display math", () => {
		const r = useMarkdown("$$\\frac{a}{b}$$");
		const mathSeg = r.segments.find((s) => s.type === "math") as any;
		expect(mathSeg).toBeDefined();
		expect(mathSeg.formula).toBe("\\frac{a}{b}");
		expect(mathSeg.displayMode).toBe(true);
	});

	it("extracts multi-line display math", () => {
		const r = useMarkdown("$$\n\nx = -b / 2a\n\n$$");
		const mathSeg = r.segments.find((s) => s.type === "math") as any;
		expect(mathSeg).toBeDefined();
		expect(mathSeg.displayMode).toBe(true);
		expect(mathSeg.formula).toContain("x = -b");
	});

	it("extracts multi-line display math with LaTeX", () => {
		const r = useMarkdown("$$\n\tx = {-b \\ sqrt{b^2 - 4ac} \\ 2a}\n\n$$");
		const mathSeg = r.segments.find((s) => s.type === "math") as any;
		expect(mathSeg).toBeDefined();
		expect(mathSeg.displayMode).toBe(true);
		expect(mathSeg.formula).toContain("sqrt");
	});
});

describe("sanitizeUrl", () => {
	it("returns '#' for empty input", () => {
		expect(sanitizeUrl("")).toBe("#");
	});

	it("passes through relative URLs", () => {
		expect(sanitizeUrl("/posts/my-post")).toBe("/posts/my-post");
		expect(sanitizeUrl("relative/path")).toBe("relative/path");
	});

	it("passes through whitelisted schemes", () => {
		expect(sanitizeUrl("https://example.com")).toBe("https://example.com/");
		expect(sanitizeUrl("http://example.com")).toBe("http://example.com/");
		expect(sanitizeUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
	});

	it("blocks non-whitelisted schemes", () => {
		expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
		expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
	});

	it("returns '#' for invalid URLs", () => {
		expect(sanitizeUrl("https://[invalid")).toBe("#");
	});

	it("blocks hostname mismatch when hostname is specified", () => {
		expect(sanitizeUrl("https://evil.com", "example.com")).toBe("#");
		expect(sanitizeUrl("https://example.com", "example.com")).toBe("https://example.com/");
	});
});

describe("sanitizeHtml", () => {
	// Trigger loadPurify so the purify variable is set and sanitizeHtml actually sanitizes
	beforeAll(async () => {
		await useMarkdownSanitised("");
	});

	it("strips script tags", () => {
		const result = sanitizeHtml("<p>Hello</p><script>alert(1)</script>");
		expect(result).not.toContain("<script>");
	});

	it("strips style tags", () => {
		const result = sanitizeHtml("<style>.x{}</style><p>Hi</p>");
		expect(result).not.toContain("<style>");
	});

	it("strips event handler attributes", () => {
		const result = sanitizeHtml('<div onclick="alert(1)">Click</div>');
		expect(result).not.toContain("onclick");
	});

	it("does not throw on normal HTML when purify is loaded", () => {
		expect(() => sanitizeHtml("<p>Safe content</p>")).not.toThrow();
	});

	it("neutralizes javascript: hrefs even after DOMPurify is loaded", () => {
		// DOMPurify passes element/handler checks in some DOM harnesses but
		// still fails to enforce its URI whitelist — stripUnsafeUrlAttrs must
		// hold the line regardless of which sanitizer is active (DEC-088).
		const result = sanitizeHtml('hello <a href="javascript:alert(1)">click</a>');
		expect(result).not.toContain('href="javascript:');
	});
});

describe("useMarkdownSanitised", () => {
	it("sanitizes HTML segments and preserves other types", async () => {
		const content = "<p>Safe</p><script>bad()</script><p>More safe</p>";
		const result = await useMarkdownSanitised(content);
		expect(result.segments.length).toBeGreaterThanOrEqual(1);
		expect(result.segments[0].type).toBe("html");
		expect(result.segments[0].html).not.toContain("<script>");
	});

	it("preserves code and image segments unchanged", async () => {
		const content = '<img src="img.png" alt="img" />\n```ts\ncode\n```';
		const result = await useMarkdownSanitised(content);
		expect(result.segments.some((s) => s.type === "image")).toBe(true);
		expect(result.segments.some((s) => s.type === "code")).toBe(true);
	});

	it("handles empty content", async () => {
		const result = await useMarkdownSanitised("");
		expect(result.segments).toEqual([]);
	});
});

describe("regexSanitize (always-active fallback)", () => {
	it("strips script tags without DOMPurify loaded", () => {
		const result = regexSanitize("<p>Hello</p><script>alert(1)</script>");
		expect(result).not.toContain("<script>");
		expect(result).toContain("<p>Hello</p>");
	});

	it("strips event handler attributes", () => {
		const result = regexSanitize('<img src=x onerror="alert(1)">');
		expect(result).not.toContain("onerror");
	});

	it("strips iframe/object/embed/form elements", () => {
		const result = regexSanitize('<iframe src="https://evil.example"></iframe><p>ok</p>');
		expect(result).not.toContain("<iframe");
	});

	it("preserves mark/em tags used by search snippets", () => {
		const result = regexSanitize("<mark>hello</mark> <em>world</em>");
		expect(result).toContain("<mark>hello</mark>");
		expect(result).toContain("<em>world</em>");
	});
});

describe("math extraction guards", () => {
	it("does not treat prices/prose with dollar signs as math", () => {
		const r = useMarkdown("原价 $5，现价 $10");
		const htmlSegs = r.segments.filter((s) => s.type === "html");
		expect(htmlSegs.length).toBe(1);
		expect(htmlSegs[0].html).toContain("原价 $5，现价 $10");
		expect(r.segments.some((s) => s.type === "math")).toBe(false);
	});

	it("still extracts real inline math", () => {
		const r = useMarkdown("公式 $a + b$ 结束");
		const mathSeg = r.segments.find((s) => s.type === "math");
		expect(mathSeg).toBeDefined();
		if (mathSeg && mathSeg.type === "math") {
			expect(mathSeg.formula).toBe("a + b");
		}
	});

	it("allows CJK inside \\text{} groups in math", () => {
		const r = useMarkdown("说明 $x = \\text{价格}$ 完成");
		const mathSeg = r.segments.find((s) => s.type === "math");
		expect(mathSeg).toBeDefined();
	});
});

describe("heading ids for TOC anchors", () => {
	it("renders headings with slugified ids", () => {
		const r = useMarkdown("## Hello World\n\n正文");
		const htmlSeg = r.segments.find((s) => s.type === "html");
		expect(htmlSeg?.html).toContain('<h2 id="hello-world">Hello World</h2>');
	});

	it("heading ids match extractToc slugs", () => {
		const content = "## 我的 文章\n\n内容";
		const r = useMarkdown(content);
		const htmlSeg = r.segments.find((s) => s.type === "html");
		const toc = extractToc(`<h2>我的 文章</h2>`);
		expect(htmlSeg?.html).toContain(`id="${toc[0].id}"`);
	});
});

describe("segment extraction edge cases", () => {
	it("leaves an empty display formula ($$ $$) intact", () => {
		const r = useMarkdown("before $$   $$ after");
		// Whitespace-only formula is not math; it stays in the HTML stream.
		expect(r.segments.every((s) => s.type !== "math")).toBe(true);
		const html = r.segments
			.filter((s): s is Extract<Segment, { type: "html" }> => s.type === "html")
			.map((s) => s.html)
			.join("");
		expect(html).toContain("$$");
	});

	it("defaults alt to an empty string for images without an alt attribute", () => {
		const r = useMarkdown('<img src="/no-alt.png" />');
		expect(r.segments).toHaveLength(1);
		expect(r.segments[0].type).toBe("image");
		expect(r.segments[0].alt).toBe("");
	});

	it("skips placeholders whose extracted segment no longer exists", () => {
		// An orphaned placeholder (key not in the extraction map) must be
		// dropped, not crash the segment walk.
		const r = useMarkdown("before <!--code:missing-key--> after");
		expect(r.segments.every((s) => s.type !== "code")).toBe(true);
	});

	it("emits no trailing html segment for whitespace-only tails", () => {
		const r = useMarkdown("```ts\ncode\n```\n   \n\t\n");
		const types = r.segments.map((s) => s.type);
		expect(types).toEqual(["code"]);
	});
});
