import { query } from "../transport";

/**
 * Admin login — POST /api/admin/login (OAuth2-style form body).
 *
 * Kept on the reactive query seam (useFetch) because the login page reads the
 * `{ data, error }` refs to distinguish invalid credentials from network
 * failures; converting to a Promise is a separate behavior change.
 */
export function adminLogin(username: string, password: string) {
	const formData = new URLSearchParams();
	formData.set("username", username);
	formData.set("password", password);

	return query<{ access_token: string }>("/api/admin/login", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: formData,
	});
}
