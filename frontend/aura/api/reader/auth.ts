import { query } from "../transport";

export interface ReaderProfile {
	id: number;
	email: string;
	display_name: string | null;
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
