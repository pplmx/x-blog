/**
 * useAdminAuth composable tests (RIL ISS-273).
 *
 * Admin auth is a localStorage JWT. The client is responsible for dropping an
 * EXPIRED token so the admin layout's guard sends the operator back to
 * /admin/login instead of a persistent semi-authed state where every call 401s.
 * A token WITHOUT an exp claim (legacy / malformed) is kept — the server still
 * validates it and the 401 guard catches rejection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminLoginMock = vi.fn();

vi.mock("~~/api/admin/auth", () => ({
	adminLogin: (...a: unknown[]) => adminLoginMock(...a),
}));

import {
	adminLoginRequest,
	isAdminAuthenticated,
	useAdminAuth,
} from "../../composables/useAdminAuth";

/** Build a fake JWT with the given `exp` (seconds since epoch). */
function jwt(payload: unknown): string {
	const b64 = (o: unknown) =>
		btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}
const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;

beforeEach(() => {
	localStorage.clear();
	// Force the module-level singleton back to a known state.
	useAdminAuth().logout();
	adminLoginMock.mockReset();
	// let handleAdminUnauthorized's hard redirect be asserted, not navigated
	Object.defineProperty(window.location, "replace", {
		value: vi.fn(),
		configurable: true,
		writable: true,
	});
});

afterEach(() => {
	localStorage.clear();
	vi.unstubAllGlobals();
});

describe("useAdminAuth", () => {
	it("is unauthenticated by default without a stored admin token", () => {
		const { isAuthenticated } = useAdminAuth();
		expect(isAuthenticated.value).toBe(false);
		expect(isAdminAuthenticated()).toBe(false);
	});

	it("login stores the token and flips auth", () => {
		const { isAuthenticated, login } = useAdminAuth();
		login("signed.jwt.token");
		expect(isAuthenticated.value).toBe(true);
		expect(localStorage.getItem("admin_token")).toBe("signed.jwt.token");
		// A fresh call re-reads the stored token and stays authenticated.
		expect(useAdminAuth().isAuthenticated.value).toBe(true);
	});

	it("logout clears the token, flips auth, and redirects to the login page", () => {
		const navigateToMock = vi.fn();
		vi.stubGlobal("navigateTo", navigateToMock);
		const { isAuthenticated, login, logout } = useAdminAuth();
		login("tok");
		expect(isAuthenticated.value).toBe(true);

		logout();

		expect(isAuthenticated.value).toBe(false);
		expect(localStorage.getItem("admin_token")).toBeNull();
		expect(navigateToMock).toHaveBeenCalledWith("/admin/login", { replace: true });
	});

	it("an expired token reads as logged out and is dropped on read (ISS-273)", () => {
		localStorage.setItem("admin_token", jwt({ exp: past() }));
		const { isAuthenticated } = useAdminAuth();
		expect(isAuthenticated.value).toBe(false);
		expect(localStorage.getItem("admin_token")).toBeNull(); // dropped
		expect(isAdminAuthenticated()).toBe(false);
	});

	it("an unexpired token reads as authenticated", () => {
		localStorage.setItem("admin_token", jwt({ exp: future() }));
		expect(useAdminAuth().isAuthenticated.value).toBe(true);
		expect(isAdminAuthenticated()).toBe(true);
	});

	it("a legacy token without an exp claim is kept (server re-validates)", () => {
		localStorage.setItem("admin_token", jwt({}));
		expect(useAdminAuth().isAuthenticated.value).toBe(true);
		expect(localStorage.getItem("admin_token")).not.toBeNull();
	});

	it("a malformed token payload is treated as legacy, not dropped", () => {
		// `!!!` is not valid base64url — tokenExpirySeconds falls back to null.
		localStorage.setItem("admin_token", `x.!!!.sig`);
		expect(useAdminAuth().isAuthenticated.value).toBe(true);
		expect(localStorage.getItem("admin_token")).not.toBeNull();
	});

	it("handleAdminUnauthorized drops the session and hard-redirects to login", () => {
		const { isAuthenticated, login, handleAdminUnauthorized } = useAdminAuth();
		login("tok");
		expect(isAuthenticated.value).toBe(true);

		handleAdminUnauthorized();

		expect(isAuthenticated.value).toBe(false);
		expect(localStorage.getItem("admin_token")).toBeNull();
		expect(window.location.replace).toHaveBeenCalledWith("/admin/login");
	});

	it("handleAdminUnauthorized preserves an internal return path in the next query (ISS-390)", () => {
		const { handleAdminUnauthorized } = useAdminAuth();
		handleAdminUnauthorized("/admin/posts/5/edit");
		expect(window.location.replace).toHaveBeenCalledWith(
			"/admin/login?next=%2Fadmin%2Fposts%2F5%2Fedit",
		);
	});

	it("handleAdminUnauthorized rejects external return paths", () => {
		const { handleAdminUnauthorized } = useAdminAuth();
		handleAdminUnauthorized("https://evil.example.com");
		expect(window.location.replace).toHaveBeenCalledWith("/admin/login");
	});

	it("login/logout keep working in-memory when localStorage is unavailable", () => {
		const originalLS = window.localStorage;
		Object.defineProperty(window, "localStorage", { value: undefined, configurable: true });
		try {
			const { isAuthenticated, login, logout } = useAdminAuth();
			expect(isAuthenticated.value).toBe(false);
			login("tok");
			expect(isAuthenticated.value).toBe(true); // in-memory only, no crash
			logout();
			expect(isAuthenticated.value).toBe(false);
		} finally {
			Object.defineProperty(window, "localStorage", { value: originalLS, configurable: true });
		}
	});

	it("adminLoginRequest calls the admin login API", async () => {
		adminLoginMock.mockResolvedValue({ access_token: "fresh.jwt.token" });
		const res = await adminLoginRequest("admin", "hunter22");
		expect(adminLoginMock).toHaveBeenCalledWith("admin", "hunter22");
		expect(res).toEqual({ access_token: "fresh.jwt.token" });
	});
});
