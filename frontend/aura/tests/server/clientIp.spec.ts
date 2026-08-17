/**
 * Tests for the trust-aware client IP resolution behind the frontend's own
 * rate limiters (og/cover image endpoints).
 *
 * Mirrors the backend's `client_rate_key` contract (RIL TASK-101, ISS-081):
 * X-Forwarded-For is honored ONLY when the socket peer is a configured trusted
 * proxy; otherwise the peer is used so a direct client cannot spoof a fresh
 * bucket by sending its own X-Forwarded-For header.
 */

import { describe, expect, it } from "vitest";

import { clientRateIp, resolveClientIp } from "../../server/utils/clientIp";

describe("resolveClientIp (pure core)", () => {
	it("returns the peer when there is no X-Forwarded-For", () => {
		expect(resolveClientIp("1.2.3.4", null, undefined)).toBe("1.2.3.4");
	});

	it("does NOT trust X-Forwarded-For when the peer is untrusted", () => {
		expect(resolveClientIp("1.2.3.4", "203.0.113.9", "")).toBe("1.2.3.4");
	});

	it("trusts the leftmost X-Forwarded-For when the peer is in the trusted list", () => {
		expect(resolveClientIp("10.0.0.1", "203.0.113.9, 10.0.0.1", "10.0.0.1, 10.0.0.2")).toBe(
			"203.0.113.9",
		);
	});

	it("trusts X-Forwarded-For from any peer when trusted is '*'", () => {
		expect(resolveClientIp("172.30.0.5", "198.51.100.7", "*")).toBe("198.51.100.7");
	});

	it("falls back to the peer when X-Forwarded-For is blank", () => {
		expect(resolveClientIp("172.30.0.5", "", "*")).toBe("172.30.0.5");
	});
});

describe("clientRateIp (H3 adapter)", () => {
	const makeEvent = (peer: string | null, xff: string | null) =>
		({
			req: { context: { clientAddress: peer }, ip: peer },
			headers: { get: (name: string) => (name === "x-forwarded-for" ? xff : null) },
		}) as never;

	it("defaults unknown peer to 'unknown'", () => {
		expect(clientRateIp(makeEvent(null, null))).toBe("unknown");
	});

	it("reads the socket peer when no X-Forwarded-For is present", () => {
		expect(clientRateIp(makeEvent("1.2.3.4", null))).toBe("1.2.3.4");
	});

	it("ignores X-Forwarded-For from an untrusted peer", () => {
		process.env.FRONTEND_TRUSTED_PROXIES = "";
		expect(clientRateIp(makeEvent("1.2.3.4", "9.9.9.9"))).toBe("1.2.3.4");
		delete process.env.FRONTEND_TRUSTED_PROXIES;
	});
});
