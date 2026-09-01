/**
 * parseApiDate tests (DEC-213).
 *
 * The backend stores/serializes naive-UTC timestamps without a zone marker;
 * a bare `new Date(str)` parses them as local wall-clock, shifting the
 * rendered instant by the viewer's UTC offset (and, near midnight, the
 * displayed date). parseApiDate appends "Z" when no zone marker is present so
 * the resulting Date is the true UTC instant — verify the ISO output is the
 * same regardless of the host process timezone, and that zone-marked values
 * pass through untouched.
 */
import { describe, expect, it } from "vitest";
import { parseApiDate } from "~~/composables/apiDate";

const NAIVE = "2026-08-31T13:52:19";

/** Round-trip a value through parseApiDate to its UTC ISO snapshot. */
function utcSnapshot(value: string | null | undefined): string | null {
	return parseApiDate(value)?.toISOString() ?? null;
}

describe("parseApiDate", () => {
	it("treats a zone-less value as UTC (naive-UTC contract)", () => {
		// Parsed as UTC: the ISO string shows the same wall-clock, in UTC.
		expect(utcSnapshot(NAIVE)).toBe("2026-08-31T13:52:19.000Z");
	});

	it("is timezone-independent: the absolute instant is stable", () => {
		// Round-tripping through UTC must be exact; a local parse would shift.
		const d = parseApiDate(NAIVE);
		expect(d?.getTime()).toBe(Date.parse(`${NAIVE}Z`));
	});

	it("passes zone-marked values through untouched", () => {
		expect(utcSnapshot("2026-08-31T13:52:19Z")).toBe("2026-08-31T13:52:19.000Z");
		expect(utcSnapshot("2026-08-31T21:52:19+08:00")).toBe("2026-08-31T13:52:19.000Z");
		expect(utcSnapshot("2026-08-31T21:52:19+0800")).toBe("2026-08-31T13:52:19.000Z");
	});

	it("returns null for empty, null or invalid input", () => {
		expect(utcSnapshot(null)).toBeNull();
		expect(utcSnapshot(undefined)).toBeNull();
		expect(utcSnapshot("")).toBeNull();
		expect(utcSnapshot("not-a-date")).toBeNull();
	});
});
