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
import { createReaderHighlight, getReaderHighlights } from "../../api/reader/highlights";

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
});
