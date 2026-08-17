/**
 * Trust-aware client IP resolution for the frontend's own rate limiters.
 *
 * Mirrors the backend's `client_rate_key` (app/limiter.py): the dynamic cover
 * and OG image endpoints are public, unauthenticated and CPU-heavy, so their
 * per-IP rate limit must key on the REAL client — not the socket peer.
 *
 * Problem (RIL TASK-101, ISS-081): `getRequestIP(event)` with no configured
 * trustProxy returns the immediate TCP peer. In the nginx deployment
 * (deploy/nginx.conf proxies `location /` → frontend) that peer is nginx for
 * every request, so every client collapsed into ONE shared rate-limit bucket —
 * one user's burst 429'd the whole site and the per-IP protection was null.
 *
 * This resolver reuses the exact trust-verification model from the backend:
 *
 * * keeps the peer when there is no X-Forwarded-For, or the peer is NOT a
 *   trusted proxy — so a client hitting the frontend directly cannot spoof a
 *   fresh bucket by sending an X-Forwarded-For header;
 * * only when the peer is trusted (``FRONTEND_TRUSTED_PROXIES`` =
 *   comma-separated IPs, or ``*`) uses the leftmost X-Forwarded-For entry,
 *   which is the original client per RFC 7239.
 *
 * `resolveClientIp` is the pure, framework-free core (unit-testable);
 * `clientRateIp(event)` adapts it to an H3 event using the socket peer and the
 * request's X-Forwarded-For header.
 */

/**
 * Pure resolver: given the socket peer IP, the X-Forwarded-For header value,
 * and the trusted-proxy list, return the real client IP.
 */
export function resolveClientIp(
	peer: string,
	xff: string | null | undefined,
	trusted: string | undefined,
): string {
	const header = (xff || "").trim();
	if (!header) return peer;
	const trustedValue = (trusted || "").trim();
	const trustedSet = new Set(
		trustedValue
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
	if (trustedValue === "*" || trustedSet.has(peer)) {
		return header.split(",")[0].trim() || peer;
	}
	return peer;
}

/** H3-event adapter: real client IP, honoring X-Forwarded-For only from trusted proxies. */
export function clientRateIp(event: {
	req?: { context?: { clientAddress?: string }; ip?: string };
	headers?: { get(name: string): string | null };
}): string {
	const peer = event?.req?.context?.clientAddress || event?.req?.ip || "unknown";
	const xff = event?.headers?.get("x-forwarded-for") ?? null;
	return resolveClientIp(peer, xff, process.env.FRONTEND_TRUSTED_PROXIES);
}
