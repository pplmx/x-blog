/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Per-process only — fine for the single-node deployment of this project.
 * Used to bound the public image-generation endpoints, which are CPU-heavy
 * (satori + sharp) and have no authentication (issue #20).
 */

/** Prune the table once it grows past this many keys. */
const CLEANUP_THRESHOLD = 10_000;

/**
 * The full-table sweep may run at most this often once past the threshold.
 *
 * Without a cadence, EVERY call — including the calls the limiter is about to
 * reject — pays an O(table-size) sweep once the threshold is crossed, so a
 * burst of distinct keys turns the limiter itself into a CPU amplifier at
 * exactly the load it exists to absorb. Per-key freshness is still enforced on
 * every access (each key's own array is filtered below), so the sweep only
 * bounds the stale keys that are never touched again; once per window is
 * plenty for that, and matches the endpoints' 60 s rate window.
 */
const CLEANUP_INTERVAL_MS = 60_000;

const buckets = new Map<string, number[]>();
let lastCleanup = 0;

/** Drop buckets whose entries have all expired under `windowMs`. */
function prune(now: number, windowMs: number): void {
	for (const [k, times] of buckets) {
		const alive = times.filter((t) => now - t < windowMs);
		if (alive.length === 0) buckets.delete(k);
		else buckets.set(k, alive);
	}
}

/**
 * Returns true when `key` has exceeded `limit` requests within `windowMs`.
 * Records the call for `key` as a side effect.
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();

	// Bound memory: when the table grows past the threshold, drop stale
	// entries — but at most once per CLEANUP_INTERVAL_MS (see above).
	if (buckets.size > CLEANUP_THRESHOLD && now - lastCleanup >= CLEANUP_INTERVAL_MS) {
		lastCleanup = now;
		prune(now, windowMs);
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

/**
 * Test-only: timestamp of the most recent full-table prune (0 if the table has
 * never needed one). Verifying the sweep cadence through the limiter's public
 * behavior is impossible — the sweep window equals the endpoints' 60 s rate
 * window, so no key is ever observable as "swept late" — but the sweep TIME
 * lets a test pin the once-per-interval contract directly.
 */
export function __lastPruneAt(): number {
	return lastCleanup;
}
