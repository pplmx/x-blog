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
 *   which is the original client per RFC 7239 — but ONLY when it is a
 *   well-formed IP literal (see ``xffClient`` below).
 *
 * The IP-literal validation is the same hardening the backend applies
 * (TASK-351/ISS-081, round-17 review): X-Forwarded-For is client-supplied
 * even when the proxy is trusted, so a forged entry (an arbitrary string, a
 * long line, or a ``client:port`` variant) must not become a fresh
 * rate-limit bucket. Without it, a caller behind the trusted proxy could
 * rotate the header value to bypass the image endpoints' per-IP limits — the
 * exact hole the backend closes in ``_xff_client``.
 *
 * `resolveClientIp` is the pure, framework-free core (unit-testable);
 * `clientRateIp(event)` adapts it to an H3 event using the socket peer and the
 * request's X-Forwarded-For header.
 */
import { isIP } from "node:net";

/**
 * Canonicalize a well-formed IP literal to the stable, bounded form the
 * rate-limit bucket keys on (mirrors ``str(ipaddress.ip_address(...))``:
 * IPv4 leading zeros collapse to their decimal value; IPv6 is lowercased).
 * Non-IP input returns ``null`` so the caller can fall back to the peer.
 */
function canonicalIp(token: string): string | null {
	const kind = isIP(token);
	if (kind === 4) {
		return token
			.split(".")
			.map((octet) => String(Number(octet)))
			.join(".");
	}
	if (kind === 6) {
		return token.toLowerCase();
	}
	return null;
}

/**
 * The original client IP from an X-Forwarded-For entry, or `null`.
 *
 * Mirror of the backend's ``_xff_client`` (app/limiter.py): take the leftmost
 * (client-supplied) node, and only trust it when it is a genuinely well-formed
 * IP literal. RFC 7239 nodes may carry a port (``203.0.113.9:8080``,
 * ``[2001:db8::1]:443``) — nginx adds the client port when the client connected
 * over a distinct source port — so strip it before validation. A garbage
 * entry (non-IP, overlong, or a spoofed string) returns `null` and the caller
 * falls back to the peer instead of minting an attacker-chosen bucket.
 */
function xffClient(xff: string): string | null {
	// TS 6 noUncheckedIndexedAccess: split(",")[0] is possibly undefined; on a
	// non-empty header the first element is always present, but a guard keeps
	// the type honest and a blank first node falls back to the peer.
	const first = xff.split(",")[0];
	if (!first) return null;
	const token = first.trim();
	if (!token) return null;
	const candidates = [token];
	if (token.startsWith("[")) {
		// [IPv6] or [IPv6]:port — the bracketed form can hold the bare address.
		const end = token.indexOf("]");
		if (end === -1) return null;
		candidates.push(token.slice(1, end));
	} else {
		// A trailing :port (valid only for an unbraced v4; a bare IPv6 has
		// colons throughout and validates on the first candidate).
		const sep = token.lastIndexOf(":");
		if (sep !== -1) candidates.push(token.slice(0, sep));
	}
	for (const cand of candidates) {
		const ip = canonicalIp(cand);
		if (ip !== null) return ip;
	}
	return null;
}

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
		// TS 6 noUncheckedIndexedAccess: split's first element is possibly
		// undefined; split(",")[0] on the trimmed header is always present.
		const first = header.split(",")[0];
		return first?.trim() ? (xffClient(first.trim()) ?? peer) : peer;
	}
	return peer;
}

/** H3-event adapter: real client IP, honoring X-Forwarded-For only from trusted proxies. */
export function clientRateIp(event: {
	req?: unknown;
	headers?: { get(name: string): string | null };
}): string {
	// `req` is typed unknown because the passed H3Event carries a Node
	// IncomingMessage (patched at runtime by h3-node with context/ip), and TS
	// does not structurally accept IncomingMessage for the narrower shape.
	const req = event.req as { context?: { clientAddress?: string }; ip?: string } | undefined;
	const peer = req?.context?.clientAddress || req?.ip || "unknown";
	const xff = event?.headers?.get("x-forwarded-for") ?? null;
	return resolveClientIp(peer, xff, process.env.FRONTEND_TRUSTED_PROXIES);
}
