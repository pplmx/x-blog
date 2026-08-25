import { readerAuthHeaders } from "../auth";
import { command, query } from "../transport";
import type { ReaderLoginResponse } from "./auth";

export interface ReaderProfile {
	id: number;
	email: string;
	display_name: string | null;
	created_at: string | null;
}

/** Current reader profile for setup usage (requires reader token). */
export function useCurrentReader() {
	return query<ReaderProfile>("/api/reader/me", {
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Download the signed-in reader's portable data bundle (DEC-126/TASK-175). */
export function getReaderDataExport(): Promise<Record<string, unknown>> {
	return command<Record<string, unknown>>("/api/reader/me/export", {
		headers: readerAuthHeaders(),
	});
}

/** Update the reader's own profile (currently display_name; email immutable). */
export function updateReaderProfile(body: { display_name?: string }): Promise<ReaderProfile> {
	return command<ReaderProfile>("/api/reader/me", {
		method: "PATCH",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body,
	});
}

/** Change the reader's password (verifies current). Returns a fresh session
 * whose token supersedes the stored one (token_version bump). */
export function changeReaderPassword(body: {
	current_password: string;
	new_password: string;
}): Promise<ReaderLoginResponse> {
	return command<ReaderLoginResponse>("/api/reader/me/password", {
		method: "POST",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body,
	});
}

/** Permanently delete the reader's own account (204 on success; 401 when the
 *  password is wrong). Past comments are anonymized, not deleted. (DEC-106) */
export function deleteReaderAccount(password: string): Promise<void> {
	return command<void>("/api/reader/me/account", {
		method: "DELETE",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body: { password },
	});
}
