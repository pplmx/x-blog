/**
 * Reader authentication composable (DEC-059, TASK-133).
 *
 * Manages the reader JWT ("reader_token" in localStorage) + the profile for
 * the signed-in reader, mirroring useAdminAuth. Distinct from admin auth: a
 * reader token is audience-separated from admin (aud=x-blog-reader) and must
 * never be reused against admin endpoints, so it lives in its own store key.
 *
 * Usage:
 *   const { isAuthenticated, reader, login, register, logout } = useReaderAuth();
 */

import type { ReaderLoginResponse, ReaderProfile } from "./useApi";

const READER_TOKEN_KEY = "reader_token";

function hasLocalStorage(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof localStorage !== "undefined" &&
		typeof localStorage.getItem === "function"
	);
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
	if (!hasLocalStorage()) return;
	if (profile) localStorage.setItem("reader_profile", JSON.stringify(profile));
	else localStorage.removeItem("reader_profile");
}

// Shared singleton state (mirrors useBookmarks/useAdminAuth): every caller
// (layout nav, /login page, bookmark sync) observes the same refs.
const isAuthenticated = ref(false);
const reader = ref<ReaderProfile | null>(null);

export function useReaderAuth() {
	// Re-read the store on every call so a re-used module instance (SSR → client
	// hydration) picks up the persisted token/profile.
	if (hasLocalStorage()) {
		isAuthenticated.value = !!localStorage.getItem(READER_TOKEN_KEY);
		reader.value = loadProfile();
	}

	/** Store the auth session from a /api/reader/{login,register} response. */
	const setSession = (session: ReaderLoginResponse): void => {
		if (hasLocalStorage()) {
			localStorage.setItem(READER_TOKEN_KEY, session.access_token);
		}
		reader.value = session.reader;
		saveProfile(session.reader);
		isAuthenticated.value = true;
	};

	const login = async (email: string, password: string): Promise<ReaderLoginResponse> => {
		const { readerLogin } = await import("~~/composables/useApi");
		const { data, error } = await readerLogin({ email, password });
		if (error.value || !data.value?.access_token) {
			throw new Error(error.value?.message || "Login failed");
		}
		setSession(data.value);
		return data.value;
	};

	const register = async (
		email: string,
		password: string,
		displayName?: string,
	): Promise<ReaderLoginResponse> => {
		const { readerRegister } = await import("~~/composables/useApi");
		const { data, error } = await readerRegister({ email, password, display_name: displayName });
		if (error.value || !data.value?.access_token) {
			throw new Error(error.value?.message || "Registration failed");
		}
		setSession(data.value);
		return data.value;
	};

	const logout = (): void => {
		if (hasLocalStorage()) {
			localStorage.removeItem(READER_TOKEN_KEY);
		}
		reader.value = null;
		saveProfile(null);
		isAuthenticated.value = false;
	};

	/**
	 * Persist a (possibly rotated) session without clearing the rest — used
	 * after a password change returns a fresh token whose version supersedes
	 * the stored one (DEC-067, TASK-141). Login/register use setSession.
	 */
	const updateToken = (session: ReaderLoginResponse): void => {
		if (hasLocalStorage()) {
			localStorage.setItem(READER_TOKEN_KEY, session.access_token);
		}
		reader.value = session.reader;
		saveProfile(session.reader);
		isAuthenticated.value = true;
	};

	/** Refresh the in-memory profile after a display_name edit (no token change). */
	const setProfile = (profile: ReaderProfile): void => {
		reader.value = profile;
		saveProfile(profile);
	};

	return { isAuthenticated, reader, login, register, logout, updateToken, setProfile };
}
