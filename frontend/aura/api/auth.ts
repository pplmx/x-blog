function authHeaders(tokenKey: "reader_token" | "admin_token"): HeadersInit {
	if (
		typeof window === "undefined" ||
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return {};
	}

	const token = localStorage.getItem(tokenKey);
	return token ? { Authorization: `Bearer ${token}` } : {};
}

export function readerAuthHeaders(): HeadersInit {
	return authHeaders("reader_token");
}

export function adminAuthHeaders(): HeadersInit {
	return authHeaders("admin_token");
}
