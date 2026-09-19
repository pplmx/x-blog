import { beforeAll, describe, expect, it } from "vitest";
import {
	addSafeLinkAttrs,
	commentMarkdownToHtml,
	markdownToHtml,
	regexSanitize,
	type Segment,
	sanitizeHtml,
	sanitizeUrl,
	useMarkdown,
	useMarkdownSanitised,
} from "~/composables/useMarkdown";
import { extractToc } from "~/composables/useToc";

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

	it("extracts markdown image syntax (how posts are authored) to the lightbox", () => {
		const r = useMarkdown("First image:\n\n![Diagram A](/uploads/a.png)");
		expect(r.segments).toHaveLength(2);
		const img = r.segments.find((s) => s.type === "image");
		expect(img?.src).toBe("/uploads/a.png");
		expect(img?.alt).toBe("Diagram A");
	});

	it("keeps markdown image order across prose chunks", () => {
		const r = useMarkdown("![A](/a.png) mid ![B](/b.png) end");
		const imgs = r.segments.filter((s) => s.type === "image");
		expect(imgs.map((i) => i.src)).toEqual(["/a.png", "/b.png"]);
	});

	it("drops an optional markdown image title from the src", () => {
		const r = useMarkdown('![Alt](/img.png "the title")');
		const img = r.segments.find((s) => s.type === "image");
		expect(img?.src).toBe("/img.png");
		expect(img?.alt).toBe("Alt");
	});

	it("leaves a backslash-escaped \\! as literal text, not an image", () => {
		const r = useMarkdown("\\![not an image](/x.png)");
		expect(r.segments.some((s) => s.type === "image")).toBe(false);
	});

	it("does not hijack ![...](...) shown inside inline code spans", () => {
		// A post documenting markdown syntax must not turn its own example into
		// a real, clickable image.
		const r = useMarkdown("use `![alt](/x.png)` to add an image");
		expect(r.segments.some((s) => s.type === "image")).toBe(false);
		// The code span survives as text (rendered code, not an image trigger).
		expect(r.segments.some((s) => s.type === "html" && s.html.includes("![alt](/x.png)"))).toBe(
			true,
		);
	});

	it("keeps balanced inner parens in a markdown image src", () => {
		const r = useMarkdown("![diagram](https://example.com/path_(x).png)");
		const img = r.segments.find((s) => s.type === "image");
		expect(img?.src).toBe("https://example.com/path_(x).png");
	});

	it("scans unterminated ![ runs linearly (no per-start-position quadratic blowup)", () => {
		// 40 KB of `![` with no `]` used to re-scan from each start position.
		// The alternation consumes the fragment in one pass; hangs would fail
		// the default timeout.
		const r = useMarkdown("![".repeat(40_000));
		expect(r.segments.some((s) => s.type === "image")).toBe(false);
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

	it("does not turn prose dollar amounts or shell vars into inline math", () => {
		// "$5 to $10", "`$PATH $HOME`" and "$5–$10" must stay literal prose, not
		// become math "5 to " / "PATH " / "5–" (the regex pairs the first two $
		// it finds — English prose and backtick code were unprotected, only CJK
		// text was).
		const prose = useMarkdown("The price is $5 to $10 depending on the plan");
		expect(prose.segments.some((s) => s.type === "math")).toBe(false);

		const shell = useMarkdown("Use `$PATH $HOME` in your profile");
		expect(shell.segments.some((s) => s.type === "math")).toBe(false);

		const dash = useMarkdown("Ticket is $5–$10 for students");
		expect(dash.segments.some((s) => s.type === "math")).toBe(false);
	});

	it("still extracts valid inline math next to prose", () => {
		// The token guard must not break real formulas, including ones that
		// open with a backslash/delimiter or end with a closing brace.
		const simple = useMarkdown("Area is $A = \\pi r^2$ for a circle");
		const m1 = simple.segments.find((s) => s.type === "math") as any;
		expect(m1).toBeDefined();
		expect(m1.formula).toBe("A = \\pi r^2");
		expect(m1.displayMode).toBe(false);

		const braced = useMarkdown("Sets satisfy $\\{x \\mid x > 0\\}$");
		expect(braced.segments.some((s) => s.type === "math")).toBe(true);
	});

	it("keeps a figure-wrapped image with its caption instead of extracting it", () => {
		// <figure><img><figcaption> must render as one block: extracting the
		// <img> into its own segment would leave an empty box + a detached
		// image + an orphaned caption.
		const r = useMarkdown(
			'<figure><img src="/img/a.png" alt="Diagram"><figcaption>Caption text</figcaption></figure>',
		);
		expect(r.segments.some((s) => s.type === "image")).toBe(false);
		const html = r.segments
			.filter((s) => s.type === "html")
			.map((s) => (s as { html: string }).html)
			.join("");
		expect(html).toContain("<figure");
		expect(html).toContain("figcaption");
		expect(html).toContain('src="/img/a.png"');
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

	it("keeps heading ids globally unique ACROSS html segments, in lockstep with the TOC", () => {
		// The same heading text on both sides of a code/mermaid/math block lands
		// in two different html segments (each rendered independently). A
		// per-segment reset of the duplicate-heading counter gave BOTH the bare
		// id — duplicated DOM ids, and the TOC's `-1`-suffixed anchor pointed at
		// nothing. The counter must be per-document, reset once by useMarkdown.
		const md = "# Setup\n\n```ts\nconst x = 1;\n```\n\n# Setup\n";
		const html = useMarkdown(md)
			.segments.map((s) => (s.type === "html" ? s.html : ""))
			.join("\n");

		const ids = Array.from(html.matchAll(/<h1[^>]*\bid="([^"]*)"/g)).map((m) => m[1]);
		expect(ids).toEqual(["setup", "setup-1"]);

		// The page builds its TOC via extractToc(markdownToHtml(content)) — the
		// ids it emits must be byte-for-byte what useMarkdown renders, or TOC
		// anchor links break.
		const tocIds = extractToc(markdownToHtml(md)).map((t) => t.id);
		expect(ids).toEqual(tocIds);
	});

	it("preserves HTML comments through the markdown pipeline", () => {
		// Post prose can carry HTML comments (excerpt markers, notes). The old
		// convertMarkdownToHtml claimed to wrap them in a NUL "placeholder" so
		// marked "doesn't touch them" — but the placeholder constant was emptied
		// long ago, so the wrapper is (and has been) a dead no-op. Pin the REAL
		// behavior: marked passes comments through verbatim, both inline and as
		// standalone blocks, so whatever they gate never silently disappears.
		const inline = useMarkdown("before <!--quiet note--> after");
		const combined = inline.segments.map((s) => (s.type === "html" ? s.html : "")).join("");
		expect(combined).toContain("<!--quiet note-->");

		const block = useMarkdown("# Setup\n\n<!--more-->\n\nBody");
		const blockHtml = block.segments.map((s) => (s.type === "html" ? s.html : "")).join("");
		expect(blockHtml).toContain("<!--more-->");
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

	it("adds target/rel to absolute links and alt to img without alt (ISS-221)", () => {
		const result = sanitizeHtml('<p><a href="https://example.com">link</a><img src="/a.png"></p>');
		expect(result).toContain('href="https://example.com"');
		expect(result).toContain('target="_blank"');
		expect(result).toContain('rel="noopener noreferrer"');
		expect(result).toContain('alt=""');
	});
});

describe("addSafeLinkAttrs (ISS-221)", () => {
	it("opens absolute http(s) links in a new tab with rel=noopener noreferrer", () => {
		expect(addSafeLinkAttrs('<a href="https://example.com">x</a>')).toBe(
			'<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
		);
		expect(addSafeLinkAttrs('<a href="http://example.com">x</a>')).toContain(
			'rel="noopener noreferrer"',
		);
	});

	it("merges with, and dedupes against, an existing rel attribute", () => {
		expect(addSafeLinkAttrs('<a rel="nofollow" href="https://example.com">x</a>')).toContain(
			'rel="nofollow noopener noreferrer"',
		);
		const deduped = addSafeLinkAttrs(
			'<a rel="noopener noreferrer" href="https://example.com">x</a>',
		);
		expect(deduped.match(/noreferrer/g)).toHaveLength(1);
	});

	it("leaves relative, fragment, mailto and href-less links untouched", () => {
		expect(addSafeLinkAttrs('<a href="/posts/foo">x</a>')).toBe('<a href="/posts/foo">x</a>');
		expect(addSafeLinkAttrs('<a href="#frag">x</a>')).toBe('<a href="#frag">x</a>');
		expect(addSafeLinkAttrs('<a href="mailto:a@b.c">x</a>')).toBe('<a href="mailto:a@b.c">x</a>');
		expect(addSafeLinkAttrs('<a name="anchor">x</a>')).toBe('<a name="anchor">x</a>');
	});

	it("honors an author-set target and reads single-quoted hrefs", () => {
		expect(addSafeLinkAttrs('<a target="_self" href="https://example.com">x</a>')).toBe(
			'<a target="_self" href="https://example.com">x</a>',
		);
		expect(addSafeLinkAttrs("<a href='https://example.com'>x</a>")).toContain('target="_blank"');
	});

	it("adds a decorative alt to images missing one, leaving existing alt intact", () => {
		expect(addSafeLinkAttrs('<img src="/a.png">')).toContain('alt=""');
		expect(addSafeLinkAttrs('<img src="/a.png" alt="hi">')).toBe('<img src="/a.png" alt="hi">');
		expect(addSafeLinkAttrs('<img src="/a.png"/>')).toContain('alt=""');
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

	it("rejects an inline formula that carries CJK outside \\text{} (kept as prose)", () => {
		// "x价格y" passes the boundary heuristics (starts/ends alphanumeric) but
		// must not become math — only \text{中文} groups are legitimate CJK.
		const r = useMarkdown("值 $x价格y$ 令");
		expect(r.segments.some((s) => s.type === "math")).toBe(false);
		const html = r.segments
			.filter((s) => s.type === "html")
			.map((s) => (s as { html: string }).html)
			.join("");
		expect(html).toContain("$x价格y$");
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

	it("duplicate headings get -1/-2 ids in both the HTML and the TOC", () => {
		// The anchor coordination invariant: the id the renderer writes into
		// the HTML for a repeated heading must equal the id extractToc derives
		// for the same document position, or the second TOC link scrolls to the
		// first heading.
		const content = "## 前言\n\n一\n\n## 前言\n\n二\n\n## 安装\n\n三";
		const { segments } = useMarkdown(content);
		const html = segments
			.filter((s) => s.type === "html")
			.map((s) => s.html)
			.join("");
		expect(html).toContain('<h2 id="前言">前言</h2>');
		expect(html).toContain('<h2 id="前言-1">前言</h2>');
		expect(html).toContain('<h2 id="安装">安装</h2>');
		// And extractToc over the RENDERED html (what the post page does: it
		// feeds markdownToHtml output, not raw markdown) agrees with it.
		const toc = extractToc(html);
		expect(toc.map((t) => t.id)).toEqual(["前言", "前言-1", "安装"]);
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

	it("drops a figure placeholder with no corresponding stashed figure", () => {
		// An authored `<!--figure:N-->` marker that extractImages did NOT stash
		// (no matching <figure> block) must be removed, not leak into the html.
		const r = useMarkdown("<p>a</p>\n<!--figure:3-->\n<p>b</p>");
		const html = r.segments
			.filter((s) => s.type === "html")
			.map((s) => (s as { html: string }).html)
			.join("");
		expect(html).not.toContain("<!--figure:3");
	});

	it("leaves a single-quoted img src untouched (not extracted)", () => {
		// The img extractor only understands double-quoted src attributes; a
		// single-quoted one must stay in the html stream, not become a segment.
		const r = useMarkdown("<img src='/a.png' alt='x' />");
		expect(r.segments.some((s) => s.type === "image")).toBe(false);
	});
});

describe("inline Markdown footnotes (DEC-441, TASK-451)", () => {
	it("renders a footnote reference as a backlinked <sup> and the definition as a footnotes list", () => {
		// GFM footnote syntax: an author citing a source gets a clickable sup
		// superscript that jumps to the definition list, instead of the raw
		// `[^1]` text that used to leak into the article (DEC-441).
		const md = "Citations are nice[^1].\n\n[^1]: The source material.";
		const html = markdownToHtml(md);
		// Reference: sup with an href/id pair so the in-text marker jumps down.
		expect(html).toContain('<sup><a href="#fn:1" id="fnref:1"');
		expect(html).toContain(">1</a></sup>");
		// Definition: an ordered list carrying the matching id and a backref.
		expect(html).toContain('id="fn:1"');
		expect(html).toContain('class="footnote-backref"');
		expect(html).toContain("The source material.");
		// The raw marker must never leak into the rendered output.
		expect(html).not.toContain("[^1]");
	});

	it("parses inline markdown inside a footnote definition", () => {
		const html = markdownToHtml(
			"[^a]\n\n[^a]: A **bold** claim with a [link](https://example.com).",
		);
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain('<a href="https://example.com">link</a>');
	});

	it("handles multiple definitions and repeated references", () => {
		const md = "One[^s] and two[^s2] and one again[^s].\n\n[^s]: Source A.\n\n[^s2]: Source B.";
		const html = markdownToHtml(md);
		// Both labels render as refs; the repeated one appears twice.
		const refCount = (html.match(/id="fnref:/g) ?? []).length;
		expect(refCount).toBe(3);
		expect(html).toContain("Source A.");
		expect(html).toContain("Source B.");
	});

	it("leaves ordinary square-bracket content untouched (no false positives)", () => {
		// Not every [^...] is a footnote: brackets used inside inline code or
		// plain text like [H2O] notation must not be flagged. A lone
		// definition with no reference still renders as a definition only when
		// the author wrote the marker; purely textual `[^x]` with no block
		// still renders the marker literally (no sup, no list).
		const html = markdownToHtml("Inline code `arr[^0]` is not a footnote.");
		expect(html).toContain("arr[^0]");
		expect(html).not.toContain("footnote-ref");
	});

	it("comments stay block-level and are not pulled into the footnotes list", () => {
		// Regression guard: the footnote block tokenizer must not consume an
		// HTML comment line as a definition.
		const md = "Text.\n\n<!-- a comment -->\n\n[^1]: Real source.";
		const html = markdownToHtml(md);
		expect(html).toContain("Real source.");
		expect(html).toContain("<!-- a comment -->");
	});

	it("does not break the TOC (footnote HTML carries no headings)", () => {
		// The footnotes list must not introduce phantom TOC entries: extractToc
		// only scans <h1..6>, and the footnote block renders <li>/<p>/<a>.
		const md = "## A section\n\nWith a note[^1].\n\n[^1]: Note.";
		const toc = extractToc(markdownToHtml(md));
		expect(toc.some((t) => t.id === "a-section")).toBe(true);
		// No selectable marker outside the real heading.
		expect(toc).toHaveLength(1);
	});

	it("footnote HTML survives sanitization (id/class/sup pass, scripts die)", () => {
		// The rendered footnote list is piped through sanitizeHtml before
		// hitting v-html; the anchor ids/classes that power the backlinks must
		// survive, and nothing executable may ride in on a definition.
		const md = "T[^s].\n\n[^s]: Safe body.\n\nAnd [^x]: <script>alert(1)</script>";
		const html = sanitizeHtml(markdownToHtml(md));
		expect(html).toContain('id="fn:s"');
		expect(html).toContain('class="footnote-ref"');
		expect(html).toContain('class="footnote-backref"');
		expect(html).not.toContain("<script");
	});
});

describe("commentMarkdownToHtml (DEC-088, TASK-156)", () => {
	it("renders comment markdown with breaks and sanitizes it", () => {
		const out = commentMarkdownToHtml("**hi**\nline two");
		expect(out).toContain("<strong>hi</strong>");
		// breaks:true turns a single newline into <br> (comment prose is
		// line-broken like the old whitespace-pre-wrap text).
		expect(out).toContain("<br>");
	});

	it("falls back to an empty string for empty input", () => {
		expect(commentMarkdownToHtml("")).toBe("");
	});

	it("still sanitizes when marked rejects the input", () => {
		// marked throws on a non-string input; the catch path must return
		// sanitized output rather than propagate a hard error to the comment.
		// @ts-expect-error deliberate bad input to exercise the catch path
		const out = commentMarkdownToHtml(Object("x"));
		expect(typeof out).toBe("string");
	});
});
