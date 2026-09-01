/**
 * Naive-UTC timestamps → real JavaScript Dates.
 *
 * Every timestamp the API returns from a naive `DateTime` column (created_at,
 * updated_at, publish_at, uploaded_at, viewed_at, ...) is stored and
 * serialized WITHOUT a zone marker. `new Date("2026-08-31T13:52:19")` parses
 * that as the browser's *local* wall-clock — which renders the wrong instant
 * for any reader whose timezone isn't UTC, and shifts the displayed date near
 * midnight. The backend contract (DEC-213) and the existing editor
 * (`toLocalInputValue`) / admin calendar (`calendar.vue` `toDate`) both treat
 * a zone-less value as UTC: append "Z" so JS interprets it as UTC and
 * `toLocale*` then converts to the viewer's real local time.
 */
export function parseApiDate(value: string | number | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	if (typeof value === "number") {
		// Epoch milliseconds (some callers/tests feed Date.UTC(...) directly).
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	const normalized = /(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
	const d = new Date(normalized);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** Raw effective-publish timestamp string for a post: its scheduled
 *  publish_at when set, else its created_at (RIL ISS-265). List cards and the
 *  archive date a post by when it went live — a scheduled post must not show
 *  the month it was drafted. */
export function effectivePublishTs(post: {
	publish_at?: string | null;
	created_at: string;
}): string {
	return post.publish_at ?? post.created_at;
}
