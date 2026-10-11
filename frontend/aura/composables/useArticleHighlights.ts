/**
 * useArticleHighlights — select-to-highlight inside a post (round 466,
 * DEC-511 / TASK-583).
 *
 * For a signed-in reader, selecting text within the article shows a "保存摘录"
 * handle; saving persists the passage (plus an optional note) to
 * /api/reader/me/highlights and wraps the passage in the article with a
 * <mark data-highlight>. On load it also fetches the reader's existing
 * highlights for the post and best-effort re-renders them. Unknown/private
 * failures are surfaced inline (non-fatal) — highlighting is an enhancement,
 * never a blocker to reading.
 */

import { onMounted, reactive, ref, watch, type Ref } from "vue";

import {
	createReaderHighlight,
	getReaderHighlights,
	type ReaderHighlight,
} from "~~/api/reader/highlights";

const HIGHLIGHT_LIMIT = 300;

export function useArticleHighlights(
	proseEl: Ref<HTMLElement | null>,
	postId: Ref<number | null | undefined>,
	isAuthenticated: Ref<boolean>,
) {
	const selection = reactive({ active: false, x: 0, y: 0, text: "" });
	const note = ref("");
	const error = ref("");
	const saved = ref(false);
	const highlights = ref<ReaderHighlight[]>([]);

	function readSelection() {
		const root = proseEl.value;
		const sel = window.getSelection();
		if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) {
			selection.active = false;
			return;
		}
		const text = sel.toString().trim();
		const anchor = sel.anchorNode;
		if (!text || !(anchor instanceof Node) || !root.contains(anchor)) {
			selection.active = false;
			return;
		}
		const rect = sel.getRangeAt(0).getBoundingClientRect();
		selection.active = true;
		selection.text = text.slice(0, HIGHLIGHT_LIMIT);
		selection.x = rect.left + rect.width / 2;
		selection.y = rect.top - 44;
	}

	function onMouseUp() {
		if (isAuthenticated.value) readSelection();
	}

	function cancel() {
		selection.active = false;
		note.value = "";
		window.getSelection()?.removeAllRanges();
	}

	/** Wrap the first occurrence of `text` inside a single text node of `root`. */
	function wrapPassage(root: HTMLElement | null, text: string, id: number) {
		if (!root || !text) return false;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (node.parentElement?.closest("mark[data-highlight]")) continue;
			const value = node.nodeValue ?? "";
			const idx = value.indexOf(text);
			if (idx < 0) continue;
			const range = document.createRange();
			range.setStart(node, idx);
			range.setEnd(node, idx + text.length);
			const mark = document.createElement("mark");
			mark.setAttribute("data-highlight", String(id));
			mark.className = "reader-highlight";
			range.surroundContents(mark);
			return true;
		}
		return false;
	}

	function renderIntoArticle(root: HTMLElement | null, items: ReaderHighlight[]) {
		for (const hl of items) {
			// Skip ones already marked (re-render after a save re-runs this).
			if (root?.querySelector(`mark[data-highlight="${hl.id}"]`)) continue;
			wrapPassage(root, hl.text, hl.id);
		}
	}

	async function save() {
		if (!postId.value || !selection.text) return;
		error.value = "";
		saved.value = false;
		try {
			const created = await createReaderHighlight(
				postId.value,
				selection.text,
				note.value.trim() || undefined,
			);
			wrapPassage(proseEl.value, selection.text, created.id);
			highlights.value = [created, ...highlights.value.filter((h) => h.id !== created.id)];
			saved.value = true;
			cancel();
		} catch {
			error.value = "failed";
		}
	}

	async function loadExisting() {
		if (!postId.value || !isAuthenticated.value) return;
		try {
			const data = await getReaderHighlights(1, 100);
			highlights.value = data.items.filter((h) => h.post_id === postId.value);
			renderIntoArticle(proseEl.value, highlights.value);
		} catch {
			// Non-fatal: reading must never depend on highlight availability.
		}
	}

	// Re-render saved passages when the requested post changes (SPA nav).
	const maybeLoad = () => {
		if (isAuthenticated.value && postId.value) void loadExisting();
	};
	watch(postId, maybeLoad);
	// Auth can arrive async (reader session hydrate) after the post is already
	// loaded — fire when it flips true too.
	watch(isAuthenticated, (authed) => {
		if (authed) maybeLoad();
	});
	// Full page load: postId/auth are already set by the time this composable
	// runs, so neither watcher above ever fires — load once on the client.
	onMounted(maybeLoad);
	// Also re-render once the prose element is available (lazy mount).
	watch(
		[proseEl, () => highlights.value.length],
		([el]) => {
			if (el) renderIntoArticle(el, highlights.value);
		},
		{ flush: "post" },
	);

	return {
		selection,
		note,
		error,
		saved,
		highlights,
		onMouseUp,
		save,
		cancel,
		loadExisting,
	};
}
