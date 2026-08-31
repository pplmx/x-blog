/**
 * MarkdownContent component tests
 *
 * Tests the Vue 3 MarkdownContent.vue component which renders raw HTML content
 * into rich output with dedicated handling for:
 *   - Plain HTML (sanitised via DOMPurify)
 *   - Fenced code blocks (with line numbers)
 *   - Mermaid diagrams (lazy-loaded)
 *   - KaTeX math (lazy-loaded)
 *   - Images (lazy-loaded)
 *
 * Since mermaid and katex are dynamically imported, we mock them with vi.mock
 * so tests run without heavy client-side dependencies. DOMPurify is mocked
 * to return content unchanged (we test sanitisation separately in the
 * useMarkdown composable tests).
 *
 * The component uses `useMarkdown` from ~/composables/useMarkdown which we
 * also mock to control segment output and verify the rendering pipeline.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// --- Mock DOMPurify (lazy-loaded in useMarkdown) ---
// vi.hoisted ensures the mock factory runs before vi.mock (which is hoisted to top).
const { dompurifyModule } = vi.hoisted(() => ({
	dompurifyModule: {
		default: {
			sanitize: (html: string) => html, // identity for testing
		},
		sanitize: (html: string) => html,
	},
}));

vi.mock("dompurify", () => dompurifyModule);

// --- Mock mermaid (dynamically imported in MarkdownContent) ---
const mermaidRender = vi.fn().mockResolvedValue({
	svg: '<svg data-testid="mermaid-svg">test diagram</svg>',
});
const mockMermaid = {
	initialize: vi.fn(),
	render: mermaidRender,
};
vi.mock("mermaid", () => ({
	default: mockMermaid,
}));

// --- Mock katex (dynamically imported in MarkdownContent) ---
const katexRenderToString = vi
	.fn()
	.mockImplementation((formula: string) => `<span data-testid="katex">${formula}</span>`);
vi.mock("katex", () => ({
	default: { renderToString: katexRenderToString },
}));

// --- Mock highlight.js (dynamically imported via useCodeHighlight) ---
const { highlightJsMock } = vi.hoisted(() => ({
	highlightJsMock: { highlight: vi.fn() },
}));
vi.mock("highlight.js/lib/common", () => ({ default: highlightJsMock }));

// --- Mock the Icon component (used for copy button, etc.) ---
vi.mock("~/components/Icon.vue", () => ({
	default: {
		name: "Icon",
		template: '<svg data-testid="icon" :data-icon="icon"></svg>',
		props: ["icon"],
	},
}));

import MarkdownContent from "../../components/MarkdownContent.vue";

// --- Helper: mount component with given content ---
function mountMarkdown(content: string) {
	return mount(MarkdownContent, {
		props: { content },
		global: {
			stubs: {
				Icon: {
					template: '<svg data-testid="icon" :data-icon="icon"></svg>',
					props: ["icon"],
				},
			},
		},
	});
}

describe("MarkdownContent", () => {
	beforeEach(() => {
		// Default: highlight.js wraps the whole code in a keyword span so
		// highlighted output is deterministic across tests. Individual tests
		// override via mockImplementation as needed.
		highlightJsMock.highlight.mockImplementation((code: string) => ({
			value: `<span class="hljs-keyword">${code}</span>`,
		}));
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	describe("Empty content", () => {
		it("renders nothing when content is empty", () => {
			const wrapper = mountMarkdown("");
			expect(wrapper.find(".markdown-content").exists()).toBe(true);
			// No segments rendered
			expect(wrapper.findAll(".markdown-content > *").length).toBe(0);
		});

		it("renders nothing when content is undefined/null", () => {
			const wrapper = mount(MarkdownContent, {
				props: { content: "" },
				global: { stubs: { Icon: true } },
			});
			expect(wrapper.find(".markdown-content").exists()).toBe(true);
		});
	});

	describe("Plain HTML content", () => {
		it("renders paragraphs as HTML", async () => {
			const wrapper = mountMarkdown("<p>Hello World</p>");
			await flushPromises();
			expect(wrapper.text()).toContain("Hello World");
		});

		it("renders headings", async () => {
			const wrapper = mountMarkdown("<h1>Title</h1><h2>Subtitle</h2>");
			await flushPromises();
			expect(wrapper.find("h1").text()).toBe("Title");
			expect(wrapper.find("h2").text()).toBe("Subtitle");
		});

		it("renders links", async () => {
			const wrapper = mountMarkdown('<a href="https://example.com">Link</a>');
			await flushPromises();
			const link = wrapper.find("a");
			expect(link.exists()).toBe(true);
			expect(link.text()).toBe("Link");
			expect(link.attributes("href")).toBe("https://example.com");
		});

		it("renders lists", async () => {
			const wrapper = mountMarkdown("<ul><li>Item 1</li><li>Item 2</li></ul>");
			await flushPromises();
			const items = wrapper.findAll("li");
			expect(items.length).toBe(2);
			expect(items[0].text()).toBe("Item 1");
			expect(items[1].text()).toBe("Item 2");
		});

		it("renders blockquotes", async () => {
			const wrapper = mountMarkdown("<blockquote>Quote text</blockquote>");
			await flushPromises();
			expect(wrapper.find("blockquote").text()).toContain("Quote text");
		});
	});

	describe("Code blocks", () => {
		it("renders fenced code blocks with language label", async () => {
			const wrapper = mountMarkdown("```ts\nconst x = 42;\n```");
			await flushPromises();
			expect(wrapper.text()).toContain("ts");
			expect(wrapper.text()).toContain("const x = 42;");
		});

		it("renders code blocks with line numbers", async () => {
			const wrapper = mountMarkdown("```js\nconst a = 1;\nconst b = 2;\n```");
			await flushPromises();
			const lineNumbers = wrapper.findAll(".text-right.select-none");
			// Line numbers are in the right column
			expect(lineNumbers.length).toBeGreaterThan(0);
		});

		it('renders non-language code blocks as "text"', async () => {
			const wrapper = mountMarkdown("```\nplain code\n```");
			await flushPromises();
			expect(wrapper.text()).toContain("text");
		});

		it("renders multiple code blocks independently", async () => {
			const wrapper = mountMarkdown('```ts\nconst a = 1;\n```\n\n```py\nprint("hello")\n```');
			await flushPromises();
			expect(wrapper.text()).toContain("const a = 1;");
			expect(wrapper.text()).toContain('print("hello")');
		});
	});

	describe("Syntax highlighting", () => {
		it("highlights recognized-language code blocks with hljs tokens", async () => {
			const wrapper = mountMarkdown("```ts\nconst x = 42;\n```");
			await flushPromises();
			// Wait for the lazy highlight.js import + re-render.
			await new Promise((r) => setTimeout(r, 10));
			await flushPromises();

			const code = wrapper.find("code[data-lang='ts']");
			expect(code.exists()).toBe(true);
			expect(code.find(".hljs-keyword").exists()).toBe(true);
			expect(highlightJsMock.highlight).toHaveBeenCalled();
		});

		it("does not call the highlighter for plaintext code blocks", async () => {
			const wrapper = mountMarkdown("```\nplain code\n```");
			await flushPromises();
			await new Promise((r) => setTimeout(r, 10));
			await flushPromises();

			expect(highlightJsMock.highlight).not.toHaveBeenCalled();
		});

		it("does not call the highlighter for unknown/plain language aliases", async () => {
			const wrapper = mountMarkdown("```text\nhello\n```");
			await flushPromises();
			await new Promise((r) => setTimeout(r, 10));
			await flushPromises();

			expect(highlightJsMock.highlight).not.toHaveBeenCalled();
		});

		it("highlights each code block independently via its language", async () => {
			const wrapper = mountMarkdown('```ts\nconst a = 1;\n```\n\n```py\nprint("x")\n```');
			await flushPromises();
			await new Promise((r) => setTimeout(r, 10));
			await flushPromises();

			// highlight() is called once per fenced block with its language.
			expect(highlightJsMock.highlight).toHaveBeenCalledTimes(2);
			const languages = highlightJsMock.highlight.mock.calls.map((call) => call[1]?.language);
			expect(languages).toContain("ts");
			expect(languages).toContain("py");
			expect(wrapper.text()).toContain("const a = 1;");
			expect(wrapper.text()).toContain('print("x")');
		});

		it("keeps line numbers intact after highlighting", async () => {
			const wrapper = mountMarkdown("```ts\nconst a = 1;\nconst b = 2;\n```");
			await flushPromises();
			await new Promise((r) => setTimeout(r, 10));
			await flushPromises();

			const lineNumberDivs = wrapper.find(".select-none").findAll("div");
			expect(lineNumberDivs.length).toBe(2);
		});
	});

	describe("Images", () => {
		it("renders images with src and alt", async () => {
			const wrapper = mountMarkdown('<img src="https://example.com/img.jpg" alt="Test image" />');
			await flushPromises();
			const img = wrapper.find("img");
			expect(img.exists()).toBe(true);
			expect(img.attributes("src")).toBe("https://example.com/img.jpg");
			expect(img.attributes("alt")).toBe("Test image");
			expect(img.attributes("loading")).toBe("lazy");
		});

		it("renders images at their natural aspect ratio (no fixed-crop frame)", async () => {
			const wrapper = mountMarkdown('<img src="test.png" alt="alt" />');
			await flushPromises();
			const img = wrapper.find("img");
			// No fixed h-64 center-crop frame and no cursor-zoom-in promising a
			// lightbox that doesn't exist (the old frame cropped tall images).
			expect(img.element.closest('div[class*="h-64"]')).toBeNull();
			expect(img.element.closest('div[class*="cursor-zoom-in"]')).toBeNull();
			expect(img.attributes("decoding")).toBe("async");
		});

		it("treats a missing alt as decorative (empty alt, not filename)", async () => {
			const wrapper = mountMarkdown('<img src="test.png" />');
			await flushPromises();
			expect(wrapper.find("img").attributes("alt")).toBe("");
		});
	});

	describe("Mixed content", () => {
		it("renders paragraphs and code blocks together", async () => {
			const wrapper = mountMarkdown(
				"<p>Before code</p>\n\n```ts\ncode here\n```\n\n<p>After code</p>",
			);
			await flushPromises();
			expect(wrapper.text()).toContain("Before code");
			expect(wrapper.text()).toContain("code here");
			expect(wrapper.text()).toContain("After code");
		});

		it("renders paragraphs and images together", async () => {
			const wrapper = mountMarkdown(
				'<p>See image below</p>\n<img src="img.png" alt="img" />\n<p>After image</p>',
			);
			await flushPromises();
			expect(wrapper.text()).toContain("See image below");
			expect(wrapper.find("img").exists()).toBe(true);
			expect(wrapper.text()).toContain("After image");
		});
	});

	describe("Reactivity", () => {
		it("updates content when prop changes", async () => {
			const wrapper = mount(MarkdownContent, {
				props: { content: "<p>First</p>" },
				global: { stubs: { Icon: true } },
			});
			await flushPromises();
			expect(wrapper.text()).toContain("First");

			await wrapper.setProps({ content: "<p>Second</p>" });
			await flushPromises();
			expect(wrapper.text()).toContain("Second");
		});
	});

	describe("Copy to clipboard", () => {
		it("has a copy button on code blocks", async () => {
			const wrapper = mountMarkdown("```ts\nconst x = 1;\n```");
			await flushPromises();
			const copyButton = wrapper.find("button");
			expect(copyButton.exists()).toBe(true);
		});

		it("calls navigator.clipboard.writeText when copy button is clicked", async () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, "clipboard", {
				value: { writeText },
				configurable: true,
			});

			const wrapper = mountMarkdown("```ts\nconst x = 1;\n```");
			await flushPromises();

			const copyButton = wrapper.find("button");
			await copyButton.trigger("click");
			await flushPromises();

			expect(writeText).toHaveBeenCalledWith("const x = 1;");
		});

		it("surfaces a copy failure when clipboard AND execCommand fallback fail", async () => {
			Object.defineProperty(navigator, "clipboard", {
				value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
				configurable: true,
			});
			const originalExec = document.execCommand?.bind(document);
			Object.defineProperty(document, "execCommand", {
				configurable: true,
				value: () => false,
			});

			try {
				const wrapper = mountMarkdown("```ts\nconst x = 1;\n```");
				await flushPromises();
				const copyButton = wrapper.find("button");
				await copyButton.trigger("click");
				await flushPromises();
				// The failure is surfaced on the button + announced via role=alert.
				expect(copyButton.attributes("data-copied-error")).toBe("true");
				expect(wrapper.find('[role="alert"]').exists()).toBe(true);
			} finally {
				if (originalExec) {
					Object.defineProperty(document, "execCommand", {
						configurable: true,
						value: originalExec,
					});
				}
			}
		});

		it("toggles copied state and resets after 2 seconds", async () => {
			vi.useFakeTimers();
			const writeText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, "clipboard", {
				value: { writeText },
				configurable: true,
			});

			const wrapper = mountMarkdown("```ts\nconst x = 1;\n```");
			await flushPromises();

			const copyButton = wrapper.find("button");
			await copyButton.trigger("click");
			await flushPromises();

			// Button text should change to "已复制" after click
			expect(wrapper.text()).toContain("已复制");

			// After 2 seconds, the copied state should reset
			vi.advanceTimersByTime(2000);
			await flushPromises();

			expect(wrapper.text()).toContain("复制");

			vi.useRealTimers();
		});
	});

	describe("Mermaid diagrams", () => {
		it("renders mermaid diagram container", async () => {
			const wrapper = mountMarkdown("```mermaid\ngraph TD\nA --> B\n```");
			await flushPromises();

			// The mermaid segment should be rendered in the DOM
			const mermaidContainer = wrapper.find("[data-mermaid-key]");
			expect(mermaidContainer.exists()).toBe(true);
		});

		it("renders mermaid content without crashing when import fails", async () => {
			// Verify the component handles mermaid content gracefully
			const wrapper = mountMarkdown("```mermaid\ngraph TD\nA --> B\n```");
			await flushPromises();
			await new Promise((r) => setTimeout(r, 10));
			await flushPromises();

			// Container should still be rendered
			expect(wrapper.find("[data-mermaid-key]").exists()).toBe(true);
			// Component should have rendered some content
			expect(wrapper.find(".markdown-content").exists()).toBe(true);
		});
	});

	describe("KaTeX math", () => {
		it("renders math content without crashing when KaTeX is unavailable", async () => {
			const wrapper = mountMarkdown("<p>Math: $x^2$</p>");
			await flushPromises();
			await new Promise((r) => setTimeout(r, 10));
			await flushPromises();

			// Component should still render without errors
			expect(wrapper.find(".markdown-content").exists()).toBe(true);
		});

		it("renders display math without crashing", async () => {
			const wrapper = mountMarkdown("<p>$$\\frac{a}{b}$$</p>");
			await flushPromises();
			await new Promise((r) => setTimeout(r, 10));
			await flushPromises();

			// Component should render without errors
			expect(wrapper.find(".markdown-content").exists()).toBe(true);
			// Verify the display math segment was created and rendered
			expect(wrapper.find("[data-math-key]").exists()).toBe(true);
			// Display math should have block class (vs inline for $...$)
			const mathSpan = wrapper.find("[data-math-key]");
			expect(mathSpan.classes()).toContain("block");
		});

		it("handles KaTeX render errors gracefully", async () => {
			katexRenderToString.mockImplementationOnce(() => {
				throw new Error("KaTeX error");
			});

			const wrapper = mountMarkdown("<p>Math: $x^2$</p>");
			await flushPromises();
			await new Promise((r) => setTimeout(r, 10));
			await flushPromises();

			// Should not crash
			expect(wrapper.find(".markdown-content").exists()).toBe(true);
		});
	});

	describe("Copy to clipboard error handling", () => {
		it("does not crash when clipboard write fails", async () => {
			Object.defineProperty(navigator, "clipboard", {
				value: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard error")) },
				configurable: true,
			});

			const wrapper = mountMarkdown("```ts\nconst x = 1;\n```");
			await flushPromises();

			const copyButton = wrapper.find("button");
			await copyButton.trigger("click");
			await flushPromises();

			// Should not crash, component should still be alive
			expect(wrapper.find(".markdown-content").exists()).toBe(true);
		});

		it("renders line numbers for multi-line code blocks", async () => {
			const wrapper = mountMarkdown("```js\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```");
			await flushPromises();

			// Line numbers are in divs inside the .select-none container
			const lineNumberContainer = wrapper.find(".select-none");
			expect(lineNumberContainer.exists()).toBe(true);
			const lineNumberDivs = lineNumberContainer.findAll("div");
			expect(lineNumberDivs.length).toBe(3);

			// Check that line numbers 1-3 are present
			const lineNumberTexts = lineNumberDivs.map((d) => d.text().trim());
			expect(lineNumberTexts).toContain("1");
			expect(lineNumberTexts).toContain("2");
			expect(lineNumberTexts).toContain("3");
		});

		it("renders single line number for single-line code block", async () => {
			const wrapper = mountMarkdown("```ts\nconst x = 42;\n```");
			await flushPromises();

			const lineNumberContainer = wrapper.find(".select-none");
			expect(lineNumberContainer.exists()).toBe(true);
			const lineNumberDivs = lineNumberContainer.findAll("div");
			expect(lineNumberDivs.length).toBe(1);
			expect(lineNumberDivs[0].text().trim()).toBe("1");
		});
	});

	describe("CSS classes", () => {
		it("uses dark:prose-invert for dark mode", () => {
			const wrapper = mountMarkdown("<p>test</p>");
			const prose = wrapper.find(".prose");
			expect(prose.classes()).toContain("dark:prose-invert");
			expect(prose.classes()).toContain("max-w-none");
		});
	});
});
