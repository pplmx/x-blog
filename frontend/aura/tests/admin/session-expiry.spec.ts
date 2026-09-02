/**
 * Admin session-expiry behaviour (RIL ISS-273).
 *
 * The backend admin JWTs carry an `exp` claim (JWT_EXPIRE_DAYS, default 1
 * day). On the client, useAdminAuth must read an expired stored token as
 * logged-out and DROP it, so the admin layout's guard redirects to
 * /admin/login — instead of a persistent semi-authed state where every admin
 * call 401s with no way to recover. handleAdminUnauthorized is the uniform
 * reaction when the server rejects a token the client clock hadn't flagged
 * (password change / token_version bump / clock skew): clear + hard-redirect.
 *
 * Uses the real composable (not a mock) with the setup-file localStorage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAdminAuthenticated, useAdminAuth } from "~/composables/useAdminAuth";

const ADMIN_TOKEN_KEY = "admin_token";
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Compose a decodable (fake-signature) JWT: header.payload.signature. */
function makeJwt(payload: Record<string, unknown>): string {
	const b64 = (o: unknown) => btoa(JSON.stringify(o));
	return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

describe("admin session expiry (ISS-273)", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
	});

	it("reads an expired stored token as logged-out and drops it", () => {
		localStorage.setItem(ADMIN_TOKEN_KEY, makeJwt({ sub: 1, exp: nowSeconds() - 3600 }));
		const { isAuthenticated } = useAdminAuth();
		expect(isAuthenticated.value).toBe(false);
		expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
	});

	it("keeps a valid (unexpired) token logged-in", () => {
		localStorage.setItem(ADMIN_TOKEN_KEY, makeJwt({ sub: 1, exp: nowSeconds() + 86400 }));
		const { isAuthenticated } = useAdminAuth();
		expect(isAuthenticated.value).toBe(true);
		expect(localStorage.getItem(ADMIN_TOKEN_KEY)).not.toBeNull();
	});

	it("treats a token without an exp claim as still-valid (the server enforces)", () => {
		// Legacy/no-claims token: keep it client-side; a server-side 401 is
		// still caught by handleAdminUnauthorized.
		localStorage.setItem(ADMIN_TOKEN_KEY, makeJwt({ sub: 1 }));
		const { isAuthenticated } = useAdminAuth();
		expect(isAuthenticated.value).toBe(true);
	});

	it("isAdminAuthenticated() is false for an expired token and purges it", () => {
		localStorage.setItem(ADMIN_TOKEN_KEY, makeJwt({ sub: 1, exp: nowSeconds() - 10 }));
		expect(isAdminAuthenticated()).toBe(false);
		expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
	});

	it("isAdminAuthenticated() is true for an unexpired token", () => {
		localStorage.setItem(ADMIN_TOKEN_KEY, makeJwt({ sub: 1, exp: nowSeconds() + 86400 }));
		expect(isAdminAuthenticated()).toBe(true);
	});

	it("handleAdminUnauthorized clears the session and hard-redirects to login", () => {
		const replace = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
		localStorage.setItem(ADMIN_TOKEN_KEY, makeJwt({ sub: 1, exp: nowSeconds() + 86400 }));
		const { isAuthenticated, handleAdminUnauthorized } = useAdminAuth();
		expect(isAuthenticated.value).toBe(true); // valid before the server 401
		handleAdminUnauthorized();
		expect(isAuthenticated.value).toBe(false);
		expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
		expect(replace).toHaveBeenCalledWith("/admin/login");
	});
});
