import { query } from "../transport";

export interface ReaderProfile {
	id: number;
	email: string;
	display_name: string | null;
	avatar_url: string | null;
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
