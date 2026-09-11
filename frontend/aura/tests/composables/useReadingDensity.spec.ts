/**
 * useReadingDensity composable tests (DEC-288, TASK-373).
 *
 * The reader's body-text density preference on the post page: three steps
 * (sm/md/lg), increase/decrease bounded at the ends, and persisted to
 * localStorage so the choice survives a reload. The wrapper style emits the
 * CSS variable that scales MarkdownContent's em-based body font.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DENSITY_STEPS, useReadingDensity } from "../../composables/useReadingDensity";

describe("useReadingDensity", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("defaults to the identity scale (md) with no stored preference", () => {
		const { step } = useReadingDensity();
		expect(step.value).toBe(1);
		expect(DENSITY_STEPS).toEqual([0.9375, 1, 1.1875]);
	});

	it("increase steps up to lg and is bound at the max", () => {
		const { step, increase, isMax } = useReadingDensity();
		increase();
		expect(step.value).toBe(1.1875);
		expect(isMax.value).toBe(true);
		increase(); // over the top — stays at lg
		expect(step.value).toBe(1.1875);
	});

	it("decrease steps down to sm and is bound at the min", () => {
		const { step, decrease, isMin } = useReadingDensity();
		decrease();
		expect(step.value).toBe(0.9375);
		expect(isMin.value).toBe(true);
		decrease(); // below the floor — stays at sm
		expect(step.value).toBe(0.9375);
	});

	it("persists the choice to localStorage and restores it", () => {
		// First instance: bump to lg, stored.
		useReadingDensity().increase();
		expect(localStorage.getItem("xblog_reading_density")).toBe("1.1875");
		// A fresh instance re-reads the stored value.
		const fresh = useReadingDensity();
		expect(fresh.step.value).toBe(1.1875);
		expect(fresh.wrapperStyle.value).toEqual({ "--reader-density": "1.1875" });
	});

	it("the wrapper style always carries the current density factor", () => {
		const { wrapperStyle, decrease } = useReadingDensity();
		expect(wrapperStyle.value).toEqual({ "--reader-density": "1" });
		decrease();
		expect(wrapperStyle.value).toEqual({ "--reader-density": "0.9375" });
	});
});
