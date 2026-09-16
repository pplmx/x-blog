import { readerAuthHeaders } from "../auth";
import { command, query } from "../transport";

export interface ReaderProfile {
	id: number;
	email: string;
	display_name: string | null;
	/** Short "about me" (round 352); null until the reader writes one. */
	bio: string | null;
	avatar_url: string | null;
	/** Opt-in public "Liked posts" profile tab (round 360, DEC-393) — false by
	 *  default; the reader's likes stay private unless they choose to publish. */
	public_likes: boolean;
	created_at: string | null;
}

export interface ReaderLoginResponse {
	access_token: string;
	token_type: string;
	reader: ReaderProfile;
}

/**
 * Reader self-registration (auto-login on the backend).
 * Retains the reactive query-style return ({ data, error, ... } refs) because
 * useReaderAuth's login/register consumers depend on Nuxt refs; converting to
 * a Promise-based return is a separate behavior change.
 */
export function readerRegister(body: { email: string; password: string; display_name?: string }) {
	return query<ReaderLoginResponse>("/api/reader/register", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		server: false,
	});
}

/** Reader login (email + password). Same ref-based contract as register. */
export function readerLogin(body: { email: string; password: string }) {
	return query<ReaderLoginResponse>("/api/reader/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		server: false,
	});
}

/**
 * Request a password-reset email (forgot-password). Always returns the same
 * response whether or not the address exists (the backend deliberately avoids
 * an account-existence oracle); the UI shows a generic success either way.
 */
export function requestPasswordReset(body: { email: string }) {
	return query<{ message: string }>("/api/reader/password-reset/request", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		server: false,
	});
}

/**
 * Redeem a password-reset token. Same ref-based contract as login/register:
 * on success the backend returns a fresh reader session (auto-login).
 */
export function confirmPasswordReset(body: { token: string; new_password: string }) {
	return query<ReaderLoginResponse>("/api/reader/password-reset/confirm", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		server: false,
	});
}

/**
 * Start a reader email change (DEC-357, TASK-404): the current password proves
 * control of the account now, and the backend emails a one-time verification
 * link to the NEW address. 202 on success (a link is on its way); wrong
 * password (401), same as current (400), already used by another account (409)
 * and SMTP unavailable (503) all throw. Not an existence oracle — the endpoint
 * is authenticated, so it is never anonymously reachable.
 */
export function requestEmailChange(body: { new_email: string; current_password: string }) {
	return command<{ message: string }>("/api/reader/me/email/request", {
		method: "POST",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body,
	});
}

/**
 * Redeem the emailed email-change token (DEC-357, TASK-404). NO auth header —
 * the emailed link is the credential. On success the backend swaps the email,
 * bumps token_version (revoking every prior session) and returns a fresh
 * auto-login session. Business-level rejections throw with their status: 400 =
 * invalid / already-used / expired link, 409 = the target address got taken
 * by another account while the link sat pending.
 */
export function completeEmailChange(token: string) {
	return command<ReaderLoginResponse>("/api/reader/me/email/confirm", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: { token },
	});
}
