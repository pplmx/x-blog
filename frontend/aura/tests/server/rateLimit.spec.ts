/**
 * Tests for the in-memory sliding-window rate limiter used by the public
 * image-generation endpoints (issue #20).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isRateLimited } from "../../server/utils/simpleRateLimit";

describe("isRateLimited", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows requests under the limit", () => {
		for (let i = 0; i < 5; i++) {
			expect(isRateLimited("under-limit-key", 5, 60_000)).toBe(false);
		}
	});

	it("rejects once the limit is exceeded", () => {
		for (let i = 0; i < 5; i++) isRateLimited("over-limit-key", 5, 60_000);
		expect(isRateLimited("over-limit-key", 5, 60_000)).toBe(true);
	});

	it("sliding window expires old requests", () => {
		for (let i = 0; i < 5; i++) isRateLimited("window-key", 5, 60_000);
		vi.advanceTimersByTime(60_001);
		expect(isRateLimited("window-key", 5, 60_000)).toBe(false);
	});

	it("keys are isolated from each other", () => {
		isRateLimited("key-a", 1, 60_000);
		expect(isRateLimited("key-a", 1, 60_000)).toBe(true);
		expect(isRateLimited("key-b", 1, 60_000)).toBe(false);
	});
});
