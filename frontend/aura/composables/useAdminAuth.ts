/**
 * Admin authentication composable for Nuxt.
 *
 * Manages admin authentication state using localStorage for token persistence.
 * Mirrors the Next.js `auth-context.tsx` pattern but using Vue 3 composables.
 *
 * Usage:
 *   const { isAuthenticated, login, logout } = useAdminAuth();
 *
 * On the server side (SSR), returns a default unauthenticated state.
 * On the client, checks localStorage for the admin token AND its JWT `exp` —
 * a session that has expired (backend `JWT_EXPIRE_DAYS`, default 1 day) reads
 * as logged-out so the admin layout's guard redirects to /admin/login instead
 * of a persistent semi-authed state where every call 401s (RIL ISS-273).
 */

const ADMIN_TOKEN_KEY = "admin_token";

function hasLocalStorage(): boolean {
	// typeof window guards SSR: on Node ≥22 with the webstorage flag the
	// localStorage global can exist without getItem being a function, which
	// crashed admin pages during SSR. Only browsers have a usable localStorage.
	return (
		typeof window !== "undefined" &&
		typeof localStorage !== "undefined" &&
		typeof localStorage.getItem === "function"
	);
}

/** The JWT `exp` claim in seconds since epoch, or null when absent/unparseable. */
function tokenExpirySeconds(token: string): number | null {
	try {
		const payload = token.split(".")[1];
		if (!payload) return null;
		const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
		const claims = JSON.parse(json) as { exp?: unknown };
		return typeof claims.exp === "number" ? claims.exp : null;
	} catch {
		return null; // malformed token — handled by the server as a 401
	}
}

/**
 * True when a usable admin session is stored: a token exists AND is not yet
 * expired. An expired token is dropped (so auth state reads logged-out and the
 * existing layout guard sends the admin back to /admin/login). A token without
 * an `exp` claim (legacy / malformed) is kept — the server still validates it,
 * and the 401 guard catches server-side rejection.
 */
function hasValidAdminToken(): boolean {
	if (!hasLocalStorage()) return false;
	const token = localStorage.getItem(ADMIN_TOKEN_KEY);
	if (!token) return false;
	const exp = tokenExpirySeconds(token);
	if (exp === null) return true;
	if (exp * 1000 <= Date.now()) {
		localStorage.removeItem(ADMIN_TOKEN_KEY);
		return false;
	}
	return true;
}

// Shared singleton state (mirrors useBookmarks/usePushSubscription): every
// useAdminAuth caller (the admin layout, login, logout buttons) observes the
// same ref. A per-call ref meant the layout's copy never saw login() setting
// it to true, leaving a blank page after SPA-navigating to /admin/posts.
// Safe on SSR: login/logout only ever run client-side, so the server's module
// copy stays false and each browser has its own client-bundle instance.
const isAuthenticated = ref(false);

export function useAdminAuth() {
	// Re-read the store on every call (client-side only). An expired-but-present
	// token is dropped here, so a return visit / SPA remount of an admin page
	// after the session lapsed reads as logged-out and the layout's unauth
	// redirect fires (RIL ISS-273).
	if (hasLocalStorage()) {
		isAuthenticated.value = hasValidAdminToken();
	}

	const login = (token: string) => {
		if (hasLocalStorage()) {
			localStorage.setItem(ADMIN_TOKEN_KEY, token);
		}
		isAuthenticated.value = true;
	};

	const logout = () => {
		if (hasLocalStorage()) {
			localStorage.removeItem(ADMIN_TOKEN_KEY);
		}
		isAuthenticated.value = false;
		// Redirect to login page
		if (typeof navigateTo !== "undefined") {
			navigateTo("/admin/login", { replace: true });
		}
	};

	/**
	 * Uniform reaction to a 401 from an admin endpoint (expired token the client
	 * clock hadn't flagged, a password change / token_version bump, or clock
	 * skew): drop the stale session and hard-redirect to /admin/login — same
	 * rationale as the layout gate, where a SPA navigateTo to a page sharing the
	 * 'admin' layout can leave the slot blank. Pages that surface a 401 also
	 * call this instead of rendering a misleading generic error (RIL ISS-273).
	 *
	 * Passing `returnTo` (an internal admin path, e.g. the post editor URL) makes
	 * the login page land the operator back WHERE they were — an autosave 401
	 * mid-draft otherwise dumped them on the bare posts list regardless of what
	 * they were editing, a jarring context loss that read as "my work vanished"
	 * (ISS-390). Only internal admin paths are accepted (same guard login.vue
	 * applies); anything else falls back to the plain login URL.
	 */
	const handleAdminUnauthorized = (returnTo?: string): void => {
		if (hasLocalStorage()) {
			localStorage.removeItem(ADMIN_TOKEN_KEY);
		}
		isAuthenticated.value = false;
		if (typeof window !== "undefined") {
			const isInternalAdminPath =
				typeof returnTo === "string" &&
				returnTo.startsWith("/admin/") &&
				!returnTo.startsWith("//") &&
				!returnTo.includes("://");
			window.location.replace(
				isInternalAdminPath ? `/admin/login?next=${encodeURIComponent(returnTo)}` : "/admin/login",
			);
		}
	};

	return { isAuthenticated, login, logout, handleAdminUnauthorized };
}

/**
 * Check if the admin is authenticated (synchronous, client-side): a token must
 * exist AND not be expired. Expired tokens are dropped (see hasValidAdminToken).
 */
export function isAdminAuthenticated(): boolean {
	return hasValidAdminToken();
}

/**
 * Admin login — calls the backend login endpoint and stores the token.
 * Returns `{ data, pending, error }` from useFetch.
 */
export async function adminLoginRequest(username: string, password: string) {
	// `~~` = project rootDir (Nuxt 4: `~` is srcDir = app/, which broke the
	// production build — the import resolved to app/composables/useApi).
	const { adminLogin } = await import("~~/api/admin/auth");
	return adminLogin(username, password);
}
