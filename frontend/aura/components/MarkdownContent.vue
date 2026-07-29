<!--
  MarkdownContent.vue

  Renders raw HTML content (as returned by the backend API) into rich, styled
  output with dedicated rendering for:

    - Fenced code blocks (with line numbers + copy button)
    - Mermaid diagrams
    - KaTeX math (inline + display)
    - Images (lazy-loaded + lightbox-ready)
    - All other HTML, sanitised with DOMPurify

  Usage:
    <MarkdownContent :content="post.content" />

  This is the Vue/Nuxt equivalent of the Next.js Markdown.tsx component,
  migrated to idiomatic Vue 3 (Composition API, <script setup>, dynamic `is`
  component dispatch instead of placeholder post-processing).
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { sanitizeHtml, useMarkdown } from "~~/composables/useMarkdown";

export interface MarkdownContentProps {
	/** Raw HTML content string from the backend. */
	content: string;
	/** Base URL for sanitising links (defaults to window.location.hostname on client). */
	baseUrl?: string;
}

const props = withDefaults(defineProps<MarkdownContentProps>(), {
	baseUrl: "",
});

// Re-process whenever content changes.
// Use a computed so segments are always in sync with content synchronously,
// with HTML segments sanitised via DOMPurify (if available) — falls back to
// identity when DOMPurify hasn't loaded yet (SSR-safe).
const segments = computed(() => {
	const { segments: raw } = useMarkdown(props.content);
	return raw.map((s) => (s.type === "html" ? { ...s, html: sanitizeHtml(s.html) } : s));
});
const renderingKeys = ref<Set<string>>(new Set());

// Track which math blocks we've already rendered to avoid double-render on re-render.
const renderedMathKeys = ref<Set<string>>(new Set());

// Track which mermaid blocks we've already rendered to avoid double-render on re-render.
const renderedMermaidKeys = ref<Set<string>>(new Set());

// --- Copy-to-clipboard state (per code block) ---
const copiedStates = ref<Set<string>>(new Set());

async function copyCode(code: string) {
	try {
		await navigator.clipboard.writeText(code);
		copiedStates.value.add(code);
		setTimeout(() => {
			copiedStates.value.delete(code);
		}, 2000);
	} catch {
		// ignore
	}
}

// --- Mermaid rendering ---
let mermaidInstance: any = null;

async function initMermaid() {
	if (mermaidInstance) return mermaidInstance;
	try {
		const { default: mermaid } = await import("mermaid");
		mermaidInstance = mermaid;
		mermaidInstance.initialize({
			startOnLoad: false,
			theme: document?.documentElement?.classList?.contains("dark") ? "dark" : "default",
			securityLevel: "loose",
		});
	} catch {
		mermaidInstance = null;
	}
	return mermaidInstance;
}

async function renderMermaid(code: string, el: HTMLElement | null, segKey: string) {
	if (!el || renderingKeys.value.has(segKey) || renderedMermaidKeys.value.has(segKey)) return;
	renderingKeys.value.add(segKey);
	const m = await initMermaid();
	if (!m) {
		el.innerHTML = `<pre class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400 text-sm">${escapeHtml(code)}</pre>`;
		return;
	}
	try {
		const id = `mermaid-${Math.random().toString(36).slice(2)}`;
		const { svg } = await m.render(id, code, el);
		el.innerHTML = svg || "";
		renderedMermaidKeys.value.add(segKey);
	} catch {
		el.innerHTML = `<pre class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400 text-sm">${escapeHtml(code)}</pre>`;
	}
	renderingKeys.value.delete(segKey);
}

// --- KaTeX rendering ---
function renderKatex(
	formula: string,
	el: HTMLElement | null,
	displayMode: boolean,
	segKey: string,
) {
	if (!el || renderedMathKeys.value.has(segKey)) return;
	renderedMathKeys.value.add(segKey);
	// Lazy-load KaTeX
	import("katex")
		.then(({ default: katex }) => {
			if (!el.isConnected) return;
			try {
				const html = katex.renderToString(formula, {
					displayMode,
					throwOnError: false,
					trust: true,
				});
				el.innerHTML = html;
			} catch {
				el.innerHTML = `<span class="text-red-500">[KaTeX render error]</span>`;
			}
		})
		.catch(() => {
			// KaTeX not available — render formula as plain text so content isn't lost.
			el.textContent = formula;
		});
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// --- Line numbers for code blocks --
function lineNumbers(code: string): number[] {
	return Array.from({ length: code.split("\n").length }, (_, i) => i + 1);
}
</script>

<template>
  <div class="prose dark:prose-invert max-w-none markdown-content">
    <template v-for="seg in segments" :key="seg.key">
      <!-- Plain HTML (sanitised) -->
      <div
        v-if="seg.type === 'html'"
        v-html="seg.html"
        class="contents"
      />

      <!-- Code block with line numbers + copy button -->
      <div
        v-else-if="seg.type === 'code'"
        class="relative group my-4 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800"
      >
        <div class="flex items-center justify-between px-4 py-2.5 bg-gray-800 dark:bg-gray-950 text-gray-300 text-sm border-b border-gray-700">
          <div class="flex items-center gap-2">
            <Icon icon="lucide:file-code" class="w-4 h-4 opacity-60" />
            <span class="font-mono font-medium">{{ seg.lang }}</span>
          </div>
          <button
            @click="copyCode(seg.code)"
            :data-copied="copiedStates.has(seg.code)"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-all duration-200 hover:bg-gray-700 hover:text-white text-gray-400"
            title="复制代码"
          >
            <Icon icon="lucide:copy" class="w-3.5 h-3.5" v-if="!copiedStates.has(seg.code)" />
            <Icon icon="lucide:check" class="w-3.5 h-3.5" v-else />
            <span>{{ copiedStates.has(seg.code) ? '已复制' : '复制' }}</span>
          </button>
        </div>
        <div class="flex bg-[#1a1b26]">
          <!-- Line numbers -->
          <div
            class="py-4 pr-4 pl-4 text-right select-none text-gray-500 text-xs font-mono leading-6 border-r border-gray-700/50"
            aria-hidden="true"
          >
            <div v-for="n in lineNumbers(seg.code)" :key="`ln-${n}`">{{ n }}</div>
          </div>
          <!-- Code -->
          <div class="flex-1 overflow-x-auto">
            <pre
              class="m-0 p-4 pl-6 text-sm leading-6 font-mono text-gray-200 whitespace-pre-wrap break-words"
            ><code :data-lang="seg.lang">{{ seg.code }}</code></pre>
          </div>
        </div>
      </div>

      <!-- Mermaid diagram -->
      <div
        v-else-if="seg.type === 'mermaid'"
        class="my-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg overflow-x-auto flex justify-center"
        :data-mermaid-key="seg.key"
        ref="el => { if (el) renderMermaid(seg.code, el, seg.key) }"
      />

      <!-- Math (inline or display) -->
      <component
        v-else-if="seg.type === 'math'"
        :is="'span'"
        :class="seg.displayMode ? 'block my-4 text-center' : 'inline'"
        :data-math-key="seg.key"
        ref="el => { if (el) renderKatex(seg.formula, el, seg.displayMode, seg.key) }"
      />

      <!-- Image (lazy + lightbox-ready) -->
      <div
        v-else-if="seg.type === 'image'"
        class="relative w-full h-64 my-4 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 cursor-zoom-in border-0 p-0"
      >
        <img
          :src="seg.src"
          :alt="seg.alt"
          class="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
          loading="lazy"
        >
      </div>

      <!-- Unknown segment type — render nothing -->
      <template v-else />
    </template>
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.markdown-content {
  @apply text-gray-800 dark:text-gray-200 leading-7;
  font-size: 1.0625rem;
}

.markdown-content :deep(p) {
  @apply my-5 leading-7;
}

.markdown-content :deep(h1) {
  @apply text-3xl sm:text-4xl font-bold mt-10 mb-5 text-gray-900 dark:text-gray-100 leading-tight;
}

.markdown-content :deep(h2) {
  @apply text-2xl font-bold mt-10 mb-4 text-gray-900 dark:text-gray-100 leading-tight pb-2 border-b border-gray-100 dark:border-gray-800;
}

.markdown-content :deep(h3) {
  @apply text-xl font-bold mt-8 mb-3 text-gray-900 dark:text-gray-100 leading-tight;
}

.markdown-content :deep(h4) {
  @apply text-lg font-semibold mt-6 mb-2 text-gray-900 dark:text-gray-100;
}

.markdown-content :deep(h1[id]),
.markdown-content :deep(h2[id]),
.markdown-content :deep(h3[id]) {
  @apply scroll-mt-24;
}

.markdown-content :deep(a) {
  @apply text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-2 decoration-blue-300 dark:decoration-blue-700 decoration-1 hover:decoration-2 transition-all;
}

.markdown-content :deep(strong) {
  @apply font-semibold text-gray-900 dark:text-gray-100;
}

.markdown-content :deep(blockquote) {
  @apply border-l-[3px] border-blue-400 dark:border-blue-600 pl-5 pr-2 py-2 my-6 text-gray-600 dark:text-gray-400 italic leading-relaxed bg-blue-50/50 dark:bg-blue-950/30 rounded-r-xl;
}

.markdown-content :deep(ul) {
  @apply my-5 pl-6 space-y-1.5;
}

.markdown-content :deep(ol) {
  @apply my-5 pl-6 space-y-1.5;
}

.markdown-content :deep(li) {
  @apply leading-relaxed;
}

.markdown-content :deep(li::marker) {
  @apply text-blue-500;
}

.markdown-content :deep(pre) {
  @apply text-sm leading-6 font-mono text-gray-200 bg-gray-900 dark:bg-gray-950 rounded-xl overflow-x-auto;
}

.markdown-content :deep(code):not(pre code) {
  @apply px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm font-mono;
}

.markdown-content :deep(pre code) {
  @apply text-sm leading-6;
}

.markdown-content :deep(img) {
  @apply rounded-xl my-8 mx-auto max-w-full h-auto shadow-md;
}

.markdown-content :deep(hr) {
  @apply my-10 border-gray-200 dark:border-gray-800;
}

.markdown-content :deep(table) {
  @apply w-full my-6 border-collapse;
}

.markdown-content :deep(th) {
  @apply px-4 py-3 bg-gray-50 dark:bg-gray-800 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700;
}

.markdown-content :deep(td) {
  @apply px-4 py-3 text-sm border-b border-gray-100 dark:border-gray-800;
}

.markdown-content :deep(tr:last-child td) {
  @apply border-b-0;
}

.markdown-content :deep(tr:hover td) {
  @apply bg-gray-50 dark:bg-gray-800/50;
}

.markdown-content :deep(kbd) {
  @apply px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs font-mono border border-gray-200 dark:border-gray-700;
}

.markdown-content :deep(.math) {
  @apply my-6 overflow-x-auto;
}
</style>
