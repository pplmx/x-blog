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
 * On the client, checks localStorage for the admin token.
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

export function useAdminAuth() {
	const isAuthenticated = ref(false);

	// Check localStorage on mount (client-side only)
	if (hasLocalStorage()) {
		isAuthenticated.value = !!localStorage.getItem(ADMIN_TOKEN_KEY);
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

	return { isAuthenticated, login, logout };
}

/**
 * Check if the admin is authenticated (synchronous, client-side).
 * Returns true if a token exists in localStorage.
 */
export function isAdminAuthenticated(): boolean {
	if (typeof localStorage === "undefined") return false;
	return !!localStorage.getItem(ADMIN_TOKEN_KEY);
}

/**
 * Admin login — calls the backend login endpoint and stores the token.
 * Returns `{ data, pending, error }` from useFetch.
 */
export async function adminLoginRequest(username: string, password: string) {
	const { adminLogin } = await import("~/composables/useApi");
	return adminLogin(username, password);
}
