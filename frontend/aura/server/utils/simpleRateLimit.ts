/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Per-process only — fine for the single-node deployment of this project.
 * Used to bound the public image-generation endpoints, which are CPU-heavy
 * (satori + sharp) and have no authentication (issue #20).
 */

/** Prune the table once it grows past this many keys. */
const CLEANUP_THRESHOLD = 10_000;

const buckets = new Map<string, number[]>();

/**
 * Returns true when `key` has exceeded `limit` requests within `windowMs`.
 * Records the call for `key` as a side effect.
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();

	if (buckets.size > CLEANUP_THRESHOLD) {
		// Bound memory: drop stale entries wholesale when the table grows.
		for (const [k, times] of buckets) {
			const alive = times.filter((t) => now - t < windowMs);
			if (alive.length === 0) buckets.delete(k);
			else buckets.set(k, alive);
		}
	}

	const times = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
	if (times.length >= limit) {
		buckets.set(key, times);
		return true;
	}
	times.push(now);
	buckets.set(key, times);
	return false;
}
