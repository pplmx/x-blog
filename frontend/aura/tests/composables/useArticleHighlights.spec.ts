/**
 * useArticleHighlights composable (round 466, DEC-511 / TASK-583).
 *
 * Verifies the non-trivial render path in a real happy-dom element: after
 * loading, existing highlights are re-rendered as <mark data-highlight>
 * inside the article (best-effort, single-text-node match). The create/update/
 * delete request wiring is covered by tests/api/reader/highlights.spec.ts.
 */

import { defineComponent, h, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useArticleHighlights } from "../../composables/useArticleHighlights";
import { createReaderHighlight, getReaderHighlights, type ReaderHighlight } from "../../api/reader/highlights";

vi.mock("~~/api/reader/highlights", () => ({
	createReaderHighlight: vi.fn(),
	getReaderHighlights: vi.fn(),
}));

let proseEl: Ref<HTMLElement | null>;

function mountHost() {
	const postId = ref<number | null>(1);
	const authenticated = ref(true);
	return mount(
		defineComponent({
			setup() {
				// The composable must be called inside setup so its onMounted/lifecycle
				// hooks register against this component instance.
				useArticleHighlights(proseEl, postId, authenticated);
				return () => h("div", { ref: proseEl }, ["Some passage to mark. And more."]);
			},
		}),
		{ attachTo: document.body },
	);
}

beforeEach(() => {
	proseEl = ref<HTMLElement | null>(null);
	vi.mocked(createReaderHighlight).mockReset();
	vi.mocked(getReaderHighlights).mockReset();
	document.body.innerHTML = "";
});

describe("useArticleHighlights", () => {
	it("re-renders a saved highlight as <mark data-highlight> on load", async () => {
		vi.mocked(getReaderHighlights).mockResolvedValue({
			items: [
				{ id: 9, post_id: 1, text: "passage to mark", note: null, created_at: null, post: null },
			],
			total: 1,
		});
		const wrapper = mountHost();

		await vi.waitFor(() => {
			const mark = document.querySelector("mark.reader-highlight");
			expect(mark?.textContent).toBe("passage to mark");
			expect(mark?.getAttribute("data-highlight")).toBe("9");
		});
		// The article fetch is narrowed server-side to the current post (post_id),
		// so a reader with >100 highlights on other posts never drowns this one.
		expect(vi.mocked(getReaderHighlights)).toHaveBeenCalledWith(1, 100, 1);

		wrapper.unmount();
	});

	it("does not render a highlight whose text is absent from the article", async () => {
		vi.mocked(getReaderHighlights).mockResolvedValue({
			items: [
				{ id: 10, post_id: 1, text: "not present anywhere", note: null, created_at: null, post: null },
			],
			total: 1,
		});
		const wrapper = mountHost();
		// Wait for the load to have run, then confirm nothing was wrapped.
		await vi.waitFor(() => expect(vi.mocked(getReaderHighlights)).toHaveBeenCalled());

		expect(document.querySelector("mark.reader-highlight")).toBeNull();
		wrapper.unmount();
	});

	it("does not wrap into the new post when the reader navigates away mid-save", async () => {
		// The save await can span an SPA nav to another /posts/[slug] (the [slug]
		// component is reused, so postId/proseEl point at the NEW post). The created
		// highlight persists server-side under the original post, but the client
		// wrap + list prepend must not run against the new post's DOM/list — the
		// ISS-572-class guard carries the savePostId and bails on a mismatch.
		let settled: (created: ReaderHighlight) => void;
		const pending = new Promise<ReaderHighlight>((res) => {
			settled = res;
		});
		const postId = ref<number | null>(1);
		const authenticated = ref(true);
		let saveFn: (() => Promise<void>) | null = null;
		let mouseUpFn: (() => void) | null = null;
		let highlightsRef: Ref<ReaderHighlight[]> | null = null;
		const wrapper = mount(
			defineComponent({
				setup() {
					const api = useArticleHighlights(proseEl, postId, authenticated);
					saveFn = api.save;
					mouseUpFn = api.onMouseUp;
					highlightsRef = api.highlights;
					return () => h("div", { ref: proseEl }, ["Some passage to mark. And more."]);
				},
			}),
			{ attachTo: document.body },
		);

		vi.mocked(createReaderHighlight).mockReturnValue(pending);
		// Select the passage (anchor inside proseEl), then let onMouseUp populate
		// the composable's reactive selection.text — only then is a save real.
		const sel = document.createRange();
		sel.selectNodeContents(proseEl.value as HTMLElement);
		document.getSelection()?.removeAllRanges();
		document.getSelection()?.addRange(sel);
		mouseUpFn!();
		// The new post's prose IS connected to the document, so a guardless
		// wrapPassage would drop a real <mark> we can observe.
		const newProse = document.createElement("div");
		newProse.textContent = "Some passage to mark. And more.";
		document.body.appendChild(newProse);
		const savePromise = saveFn!();
		postId.value = 2;
		proseEl.value = newProse; // new post's prose node
		// Resolve the save: it must bail — neither wrap the new post's prose nor
		// prepend the stale highlight into the new post's list.
		settled({ id: 99, post_id: 2, text: "Some passage to mark. And more.", note: null, created_at: null, post: null });
		await savePromise;

		expect(newProse.querySelector("mark.reader-highlight")).toBeNull();
		expect(highlightsRef!.value.some((h) => h.id === 99)).toBe(false);
		wrapper.unmount();
		newProse.remove();
	});

	it("does not paint the old post's highlights into the new post's prose when the reader navigates mid-load", async () => {
		// loadExisting awaits getReaderHighlights; if the reader SPA-navigates to
		// another /posts/[slug] while it's in flight, the stale resolve must not
		// overwrite the NEW post's highlight list or inject <mark>s into its prose.
		// Mirrors the save() nav guard (ISS-572-class, ISS-672).
		const stale = Promise.withResolvers<{ items: ReaderHighlight[]; total: number }>();
		const fresh = Promise.withResolvers<{ items: ReaderHighlight[]; total: number }>();
		// call 1 = post 1 (deferred), call 2 = post 2 (deferred) — both controlled
		// so the stale resolve can't be masked by a later concurrent overwrite.
		vi.mocked(getReaderHighlights)
			.mockReturnValueOnce(stale.promise)
			.mockReturnValueOnce(fresh.promise);
		const postId = ref<number | null>(1);
		const authenticated = ref(true);
		let highlightsRef: Ref<ReaderHighlight[]> | null = null;
		const wrapper = mount(
			defineComponent({
				setup() {
					const api = useArticleHighlights(proseEl, postId, authenticated);
					highlightsRef = api.highlights;
					return () => h("div", { ref: proseEl }, ["Some passage to mark. And more."]);
				},
			}),
			{ attachTo: document.body },
		);

		// Flip to a new post while the post-1 load is pending: postId+proseEl now
		// point at the new post, whose prose is a DIFFERENT connected node.
		const newProse = document.createElement("div");
		newProse.textContent = "Different post content.";
		document.body.appendChild(newProse);
		postId.value = 2;
		proseEl.value = newProse;
		// Resolve the STALE load for post 1 (post-2's load stays pending, so the
		// post-1 continuation is the only writer at this moment). A guardless
		// loadExisting would render the stale <mark> into the new post's prose
		// and drop it into the new list right now.
		stale.resolve({
			items: [{ id: 55, post_id: 1, text: "Some passage to mark.", note: null, created_at: null, post: null }],
			total: 1,
		});
		await vi.waitFor(() => {
			expect(highlightsRef!.value).toBeDefined();
			// Let the stale resolve's continuation settle.
		});
		await Promise.resolve();

		expect(newProse.querySelector("mark.reader-highlight")).toBeNull();
		expect(highlightsRef!.value.some((h) => h.id === 55)).toBe(false);

		// Finish the current post's own load (post 2, empty) so the suite ends
		// clean and confirms the fresh request came through with the new post id.
		fresh.resolve({ items: [], total: 0 });
		await vi.waitFor(() => {
			expect(vi.mocked(getReaderHighlights).mock.calls.some((c) => c[2] === 2)).toBe(true);
		});
		wrapper.unmount();
		newProse.remove();
	});
});
