import { readerAuthHeaders } from "../auth";
import { command, query } from "../transport";
import type { ReaderLoginResponse } from "./auth";

export interface ReaderProfile {
	id: number;
	email: string;
	display_name: string | null;
	/** Short "about me" (round 352): reader-written plain text on the public
	 *  profile page; null until the reader writes one. */
	bio: string | null;
	avatar_url: string | null;
	/** Opt-in public "Liked posts" profile tab (round 360, DEC-393) — false by
	 *  default; the reader's likes stay private unless they choose to publish. */
	public_likes: boolean;
	/** Opt-in public "Saved posts" profile tab (round 363, DEC-399) — false by
	 *  default; the reader's curated bookmarks stay private unless published. */
	public_bookmarks: boolean;
	/** TOTP 2FA flag (round 364, DEC-401): true when login demands a second
	 *  step. Present on the authenticated /me envelope only — the secret itself
	 *  is never exposed by any endpoint. */
	two_factor_enabled: boolean;
	created_at: string | null;
}

/** Current reader profile for setup usage (requires reader token). */
export function useCurrentReader() {
	return query<ReaderProfile>("/api/reader/me", {
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Upload (or replace) the reader's profile picture (DEC-299/TASK-378). */
export function uploadReaderAvatar(file: File): Promise<ReaderProfile> {
	const formData = new FormData();
	formData.append("file", file);
	return command<ReaderProfile>("/api/reader/me/avatar", {
		method: "POST",
		headers: readerAuthHeaders(),
		body: formData,
	});
}

/** Remove the reader's profile picture (DEC-299/TASK-378). */
export function removeReaderAvatar(): Promise<ReaderProfile> {
	return command<ReaderProfile>("/api/reader/me/avatar", {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}

/** Download the signed-in reader's portable data bundle (DEC-126/TASK-175). */
export function getReaderDataExport(): Promise<Record<string, unknown>> {
	return command<Record<string, unknown>>("/api/reader/me/export", {
		headers: readerAuthHeaders(),
	});
}

/** Update the reader's own profile (display_name, bio, public_likes,
 * public_bookmarks; email immutable — explicit null bio clears it). */
export function updateReaderProfile(body: {
	display_name?: string;
	bio?: string | null;
	/** Opt-in publishing of the public "Liked posts" profile tab (round 360). */
	public_likes?: boolean;
	/** Opt-in publishing of the public "Saved posts" profile tab (round 363). */
	public_bookmarks?: boolean;
}): Promise<ReaderProfile> {
	return command<ReaderProfile>("/api/reader/me", {
		method: "PATCH",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body,
	});
}

/**
 * TOTP 2FA management (round 364, DEC-401). setup returns the base32 secret +
 * otpauth URI (nothing is enabled yet); enable proves possession with one
 * 6-digit code and flips the flag; disable requires the current password AND a
 * valid code. The flag rides the returned ReaderProfile so /account can adopt
 * the fresh state; the secret itself is never returned after setup.
 */
export interface TwoFactorSetup {
	secret: string;
	otpauth_uri: string;
}

export function setupReader2FA(): Promise<TwoFactorSetup> {
	return command<TwoFactorSetup>("/api/reader/me/2fa/setup", {
		method: "POST",
		headers: readerAuthHeaders(),
	});
}

export function enableReader2FA(current_password: string, code: string): Promise<ReaderProfile> {
	return command<ReaderProfile>("/api/reader/me/2fa/enable", {
		method: "POST",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body: { current_password, code },
	});
}

export function disableReader2FA(current_password: string, code: string): Promise<ReaderProfile> {
	return command<ReaderProfile>("/api/reader/me/2fa/disable", {
		method: "POST",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body: { current_password, code },
	});
}

/** Persist the reader's notification-copy language (DEC-338/TASK-395): the
 * durable inbox titles and emails are generated with this locale once the
 * language switcher calls it for a signed-in reader. */
export function setReaderLocale(locale: "en" | "zh"): Promise<{ locale: "en" | "zh" }> {
	return command<{ locale: "en" | "zh" }>("/api/reader/me/locale", {
		method: "PUT",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body: { locale },
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
