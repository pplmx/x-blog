/**
 * readingMinutes (CJK-aware) tests (RIL round 72, ISS-051).
 *
 * Whitespace tokens plus each CJK char count as one word (~200wpm); the result
 * is whole minutes with a floor of 1, so a Chinese post with no spaces is not
 * collapsed to a 1-minute read and empty content never reads as 0 minutes.
 */

import { describe, expect, it } from "vitest";
import { readingMinutes } from "../../composables/useReadingTime";

describe("readingMinutes", () => {
	it("returns the 1-minute floor for empty / missing content", () => {
		expect(readingMinutes("")).toBe(1);
		expect(readingMinutes(null)).toBe(1);
		expect(readingMinutes(undefined)).toBe(1);
		expect(readingMinutes("   \n\t ")).toBe(1);
	});

	it("estimates from plain English words", () => {
		// ~400 words → 2 minutes at 200wpm.
		const words = Array.from({ length: 400 }, (_, i) => `token${i}`).join(" ");
		expect(readingMinutes(words)).toBe(2);
	});

	it("counts every CJK character as a word, not just whitespace-delimited tokens", () => {
		// 620 CJK chars with no spaces must read as 3 minutes, NOT 1.
		expect(readingMinutes("本".repeat(620))).toBe(3);
	});

	it("combines CJK characters and latin words", () => {
		// 100 latin words + 100 CJK chars = 200 words → 1 minute.
		const mixed = `${Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ")} ${"读".repeat(100)}`;
		expect(readingMinutes(mixed)).toBe(1);
	});

	it("ignores markdown noise when tokenizing", () => {
		// #, *, backticks and newlines are stripped before counting.
		const md = `# Title\n\n**bold** \`code\`\n\nBody text here.`;
		// tokens: Title, bold, code, Body, text, here. → 6 words → floor 1.
		expect(readingMinutes(md)).toBe(1);
	});

	it("a sub-threshold word count floors at 1 minute", () => {
		expect(readingMinutes("just a few words")).toBe(1);
	});
});
