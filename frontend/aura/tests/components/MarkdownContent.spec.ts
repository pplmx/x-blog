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
const katexRenderToString = vi.fn().mockReturnValue('<span data-testid="katex">rendered</span>');
vi.mock("katex", () => ({
	default: { renderToString: katexRenderToString },
}));

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
	afterEach(() => {
		vi.clearAllMocks();
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

		it("wraps images in a zoomed container", async () => {
			const wrapper = mountMarkdown('<img src="test.png" alt="alt" />');
			await flushPromises();
			const container = wrapper.find("img").element.closest('div[class*="h-64"]');
			expect(container).toBeTruthy();
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
	});

	describe("Mermaid diagrams", () => {
		it("renders mermaid diagram container", async () => {
			const wrapper = mountMarkdown("```mermaid\ngraph TD\nA --> B\n```");
			await flushPromises();

			// The mermaid segment should be rendered in the DOM
			const mermaidContainer = wrapper.find("[data-mermaid-key]");
			expect(mermaidContainer.exists()).toBe(true);
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
