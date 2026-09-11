/**
 * Reader reading-density preference (DEC-288, TASK-373).
 *
 * Long-form reading comfort: a reader can scale the article body text up or
 * down (3 steps) to suit their eyes/display. The choice is device-local
 * (localStorage), applies to the post page's prose via a CSS variable
 * (`--reader-density`) that scales the Markdown body's `em`-based font/line
 * height — headings stay prominent, so hierarchy survives. Deliberately a
 * client-only preference (no account field): it is a per-device comfort
 * setting, like the reading mode, not identity data.
 *
 * The variable is set on `document.documentElement` imperatively (post-mount)
 * rather than bound to a component's `:style`: Vue's SSR hydration does not
 * reliably reconcile a `:style` object binding on an element whose server
 * markup carried the un-persisted default, so a stored density would re-render
 * as the default until the next interaction (seen in the browser e2e). An
 * inherited CSS var set at the root works regardless of hydration.
 */

import { computed, ref, watchEffect } from "vue";

export const DENSITY_STEPS = [0.9375, 1, 1.1875] as const;
export type DensityStep = (typeof DENSITY_STEPS)[number];

const DENSITY_KEY = "xblog_reading_density";
// Module-scoped so every caller observes the same step (and the root var is
// only ever set once per document load).
const DENSITY_VAR = "--reader-density";

function loadStep(): DensityStep {
	if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
		return 1;
	}
	const raw = Number(localStorage.getItem(DENSITY_KEY));
	return (DENSITY_STEPS as readonly number[]).includes(raw) ? (raw as DensityStep) : 1;
}

const step = ref<DensityStep>(loadStep());

function applyToRoot() {
	if (typeof document !== "undefined") {
		document.documentElement.style.setProperty(DENSITY_VAR, String(step.value));
	}
}

export function useReadingDensity() {
	// Re-sync from the store on every call (mirrors useReaderAuth): a
	// long-lived module instance (SSR → client hydration, or a test that
	// cleared storage) picks up the persisted value instead of a stale ref.
	step.value = loadStep();
	// Imperatively push the current step onto <html>; SSR never runs this (no
	// document), and post-hydration it applies the persisted value regardless
	// of how the server rendered the page.
	watchEffect(applyToRoot);

	const save = (next: DensityStep) => {
		step.value = next;
		applyToRoot();
		if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
			localStorage.setItem(DENSITY_KEY, String(next));
		}
	};

	const increase = () => {
		const idx = DENSITY_STEPS.indexOf(step.value);
		const next = DENSITY_STEPS[idx + 1];
		if (next !== undefined) save(next);
	};
	const decrease = () => {
		const idx = DENSITY_STEPS.indexOf(step.value);
		const prev = DENSITY_STEPS[idx - 1];
		if (prev !== undefined) save(prev);
	};

	const isMin = computed(() => step.value === DENSITY_STEPS[0]);
	const isMax = computed(() => step.value === DENSITY_STEPS[DENSITY_STEPS.length - 1]);

	const wrapperStyle = computed(
		() => ({ [DENSITY_VAR]: String(step.value) }) as Record<string, string>,
	);

	return { DENSITY_STEPS, step, increase, decrease, isMin, isMax, wrapperStyle };
}
