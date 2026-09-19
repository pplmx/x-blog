/**
 * Shared backend-error message extraction.
 *
 * Every HTTP error the backend produces is wrapped in the
 * {"error":{"code","message","details"}} envelope (main.py's HTTPException and
 * validation handlers), and command()/query() surface that parsed body on the
 * transport error's `.data`. The error's own `.message` is only ofetch's
 * technical string ("[POST] \"...\": 429 Too Many Requests") — useless in a
 * form. This helper returns the human text with a caller-provided localized
 * fallback (round 393/394; used by the reader-auth composables and every admin
 * list page, replacing six copy-pasted local `getErrorMessage` helpers).
 *
 * Order: backend envelope message → a non-HTTP local Error's own message
 * (client-side validation thrown by code carries no envelope and no status, so
 * its message is meaningful) → caller's localized fallback. An HTTP failure
 * with no readable envelope never leaks ofetch's technical string.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
	const envelope = (error as { data?: { error?: { message?: string } } } | undefined)?.data?.error
		?.message;
	if (typeof envelope === "string" && envelope.length > 0) return envelope;
	const message = (error as { message?: unknown } | undefined)?.message;
	const isHttpError =
		typeof (error as { status?: unknown } | undefined)?.status === "number" ||
		typeof (error as { statusCode?: unknown } | undefined)?.statusCode === "number";
	if (!isHttpError && typeof message === "string" && message.length > 0) return message;
	return fallback;
}
