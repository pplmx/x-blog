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

/**
 * Normalize a naive-UTC wire timestamp to an explicit-UTC ISO 8601 string by
 * appending "Z" when the value carries no zone marker (the DEC-213 contract:
 * the backend serializes naive UTC bare). `parseApiDate` asserts "Z" before
 * `new Date(...)` so *display* is correct, but machine consumers — JSON-LD
 * schema.org dates and OpenGraph `article:published_time`/`modified_time` —
 * read the raw string: a zone-less "2026-09-20T23:30:00" is interpreted as
 * *local* time by crawlers, so a UTC+8 audience renders such a post a whole
 * day early on share cards / Rich Results. Appending the marker makes the
 * instant unambiguous without touching local display (round-429 deep dive).
 */
export function toIsoUtc(value: string | undefined | null): string | undefined {
	if (!value) return undefined;
	return /(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
}

/**
 * The site's canonical full-date format (round-417 consistency, ISS-573):
 * `September 22, 2026` / `2026年9月22日` — NOT the bare locale default
 * ("9/22/2026"), which is ambiguous (m/d vs d/m) and differs from the rich
 * form PostCard / the article page / bookmarks already used, so the same post
 * read like a different date depending on the page. Accepts the app locale
 * code ("zh" | "en") like the callers already pass to toLocaleDateString.
 */
export function formatPostDate(value: string | number | null | undefined, locale: string): string {
	return (
		parseApiDate(value)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
			year: "numeric",
			month: "long",
			day: "numeric",
		}) ?? ""
	);
}
