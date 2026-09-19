/**
 * Reader authentication composable (DEC-059, TASK-133).
 *
 * Manages the reader JWT ("reader_token" in localStorage) + the profile for
 * the signed-in reader, mirroring useAdminAuth. Distinct from admin auth: a
 * reader token is audience-separated from admin (aud=x-blog-reader) and must
 * never be reused against admin endpoints, so it lives in its own store key.
 *
 * Usage:
 *   const { isAuthenticated, reader, login, register, resetPassword, logout } = useReaderAuth();
 */

import type { ReaderLoginResponse, ReaderProfile } from "~~/api/reader/auth";

const READER_TOKEN_KEY = "reader_token";

function hasLocalStorage(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof localStorage !== "undefined" &&
		typeof localStorage.getItem === "function"
	);
}

/** Best-effort persistence: a storage write that throws (private-mode quota,
 *  Safari's third-party-storage block) must NOT fail the auth call that has
 *  already succeeded server-side. The in-memory singleton carries the session
 *  for the tab, and the next useReaderAuth() call re-reads what got stored
 *  (reader-auth deep-dive finding). */
function writeStorage(key: string, value: string | null): void {
	if (!hasLocalStorage()) return;
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		/* no-op: in-memory state still holds the session for this tab */
	}
}

function loadProfile(): ReaderProfile | null {
	if (!hasLocalStorage()) return null;
	try {
		const raw = localStorage.getItem("reader_profile");
		return raw ? (JSON.parse(raw) as ReaderProfile) : null;
	} catch {
		return null;
	}
}

function saveProfile(profile: ReaderProfile | null): void {
	writeStorage("reader_profile", profile ? JSON.stringify(profile) : null);
}

/**
 * Pull the human-readable failure text off a transport error. The backend wraps
 * every HTTP error in {"error":{"code","message","details"}}, and query()/
 * command() surface that parsed body on the FetchError's `.data`. The error's
 * `.message` is only ofetch's technical string ("[...]: 401 Unauthorized") —
 * useless in a form. Falls back to the technical string, then the caller's own
 * default (reader-auth deep-dive finding).
 */
function apiErrorMessage(error: unknown, fallback: string): string {
	const envelope = (error as { data?: { error?: { message?: string } } } | undefined)?.data?.error
		?.message;
	if (typeof envelope === "string" && envelope.length > 0) return envelope;
	const technical = (error as { message?: string } | undefined)?.message;
	return typeof technical === "string" && technical.length > 0 ? technical : fallback;
}

// Shared singleton state (mirrors useBookmarks/useAdminAuth): every caller
// (layout nav, /login page, bookmark sync) observes the same refs.
const isAuthenticated = ref(false);
const reader = ref<ReaderProfile | null>(null);

/**
 * True when a rejected reader API call means an expired/invalid reader session
 * (ISS-110) — NOT a business-level 401. The backend uses the same status for
 * two different conditions: the auth dependency raises 401 (detail "Could not
 * validate credentials") on an expired/revoked token, while /me/password and
 * /me/account raise 401 ("Incorrect current password") on a genuinely wrong
 * current password. Conflating the two made the account page report "wrong
 * password" for a dead session (and, via the wrong status shape, sometimes
 * show a generic error). Distinguish by the error body's detail.
 */
export function isStaleSession(cause: unknown): boolean {
	const status =
		(cause as { statusCode?: number } | undefined)?.statusCode ??
		(cause as { response?: { status?: number } } | undefined)?.response?.status;
	if (status !== 401) return false;
	// The backend wraps every reader rejection in {"error":{"message":...}} with
	// NO top-level `detail` (round-391 envelope work), surfaced by command() on
	// `error.data` and on `error.response._data`. /me/password and /me/account
	// raise 401 for BOTH a dead session ("Could not validate credentials") and a
	// genuinely wrong current password ("Incorrect current password") — read the
	// envelope message (keeping the legacy top-level detail shape too) so a
	// wrong password is a form-level error, not a silent sign-out (round-393).
	const data =
		(cause as { response?: { _data?: unknown } } | undefined)?.response?._data ??
		(cause as { data?: unknown } | undefined)?.data;
	const message =
		(data as { error?: { message?: string } } | undefined)?.error?.message ??
		(data as { detail?: string } | undefined)?.detail;
	// An explicit wrong-password 401 is a form-level error, not a dead session.
	if (typeof message === "string" && message.toLowerCase().includes("password")) return false;
	return true;
}

export function useReaderAuth() {
	// Re-read the store on every call so a re-used module instance (SSR → client
	// hydration) picks up the persisted token/profile.
	if (hasLocalStorage()) {
		isAuthenticated.value = !!localStorage.getItem(READER_TOKEN_KEY);
		reader.value = loadProfile();
	}

	/** Store the auth session from a /api/reader/{login,register} response. */
	const setSession = (session: ReaderLoginResponse): void => {
		// A complete session (token + reader) is the whole contract; a 2FA
		// challenge response (round 364) never reaches here — login() short-
		// circuits on two_factor_required before it is passed.
		if (!session.access_token || !session.reader) return;
		writeStorage(READER_TOKEN_KEY, session.access_token);
		reader.value = session.reader;
		saveProfile(session.reader);
		isAuthenticated.value = true;
	};

	const login = async (email: string, password: string): Promise<ReaderLoginResponse> => {
		const { readerLogin } = await import("~~/api/reader/auth");
		const { data, error } = await readerLogin({ email, password });
		if (error.value) {
			throw new Error(apiErrorMessage(error.value, "Login failed"));
		}
		// 2FA readers (round 364, DEC-401): the first step only proves the
		// password, so no session is stored here — the caller sees
		// two_factor_required and drives the second step via login2FA().
		if (data.value?.two_factor_required) {
			return data.value;
		}
		if (!data.value?.access_token) {
			throw new Error("Login failed");
		}
		setSession(data.value);
		return data.value;
	};

	/** Complete a 2FA login: exchange the challenge token + authenticator code
	 *  for the real session (round 364, DEC-401). Caller must hold an mfa_token
	 *  from a prior `login()` that reported `two_factor_required`. */
	const login2FA = async (mfaToken: string, code: string): Promise<ReaderLoginResponse> => {
		const { readerLogin2FA } = await import("~~/api/reader/auth");
		const { data, error } = await readerLogin2FA({ mfa_token: mfaToken, code });
		if (error.value || !data.value?.access_token) {
			throw new Error(apiErrorMessage(error.value, "Login failed"));
		}
		setSession(data.value);
		return data.value;
	};

	const register = async (
		email: string,
		password: string,
		displayName?: string,
	): Promise<ReaderLoginResponse> => {
		const { readerRegister } = await import("~~/api/reader/auth");
		const { data, error } = await readerRegister({ email, password, display_name: displayName });
		if (error.value || !data.value?.access_token) {
			throw new Error(apiErrorMessage(error.value, "Registration failed"));
		}
		setSession(data.value);
		return data.value;
	};

	const logout = (): void => {
		writeStorage(READER_TOKEN_KEY, null);
		reader.value = null;
		saveProfile(null);
		isAuthenticated.value = false;
	};

	/**
	 * Redeem a password-reset token and adopt the fresh auto-login session
	 * (DEC-286, TASK-371). The backend bumps token_version on reset, so the
	 * returned token supersedes any previously stored one — updateToken (like
	 * the in-account password change) is the right persistence path.
	 */
	const resetPassword = async (
		token: string,
		newPassword: string,
	): Promise<ReaderLoginResponse> => {
		const { confirmPasswordReset } = await import("~~/api/reader/auth");
		const { data, error } = await confirmPasswordReset({ token, new_password: newPassword });
		if (error.value || !data.value?.access_token) {
			// Preserve the HTTP status (a 400 = used/expired reset token, i.e. a
			// business-level rejection, NOT a network failure) on the thrown
			// error so the reset page can tell "invalid link" from "network".
			const status =
				(error.value as { statusCode?: number } | undefined)?.statusCode ??
				(error.value as { status?: number } | undefined)?.status;
			const err = new Error(apiErrorMessage(error.value, "Password reset failed")) as Error & {
				statusCode?: number;
			};
			if (status !== undefined) err.statusCode = status;
			throw err;
		}
		updateToken(data.value);
		return data.value;
	};

	/**
	 * Redeem an emailed email-change token and adopt the fresh session
	 * (DEC-357, TASK-404). The backend swaps the email and bumps token_version,
	 * so the returned token supersedes the stored one — updateToken (like
	 * password reset / change) is the right persistence path. Business-level
	 * rejection statuses (400 = used/expired/invalid link, 409 = target taken
	 * while pending) ride the thrown error so the page can distinguish an
	 * invalid link from a network failure.
	 */
	const confirmEmailChange = async (token: string): Promise<ReaderLoginResponse> => {
		const { completeEmailChange } = await import("~~/api/reader/auth");
		// command() rethrows the FetchError (statusCode/status preserved).
		const session = await completeEmailChange(token);
		updateToken(session);
		return session;
	};

	/**
	 * Persist a (possibly rotated) session without clearing the rest — used
	 * after a password change returns a fresh token whose version supersedes
	 * the stored one (DEC-067, TASK-141). Login/register use setSession.
	 */
	const updateToken = (session: ReaderLoginResponse): void => {
		// Same completeness guard as setSession — a fresh rotated token is the
		// only path here (password change / email confirm), which always has one.
		if (!session.access_token || !session.reader) return;
		writeStorage(READER_TOKEN_KEY, session.access_token);
		reader.value = session.reader;
		saveProfile(session.reader);
		isAuthenticated.value = true;
	};

	/** Refresh the in-memory profile after a display_name edit (no token change). */
	const setProfile = (profile: ReaderProfile): void => {
		reader.value = profile;
		saveProfile(profile);
	};

	return {
		isAuthenticated,
		reader,
		login,
		login2FA,
		register,
		resetPassword,
		confirmEmailChange,
		logout,
		updateToken,
		setProfile,
		isStaleSession,
	};
}
