import { command } from "../transport";

/**
 * Guest email newsletter (DEC-351, TASK-401).
 *
 * An anonymous visitor subscribes with an email address; the backend replies
 * with one generic message regardless of whether the address is new, already
 * subscribed, or previously unsubscribed (no email-existence oracle), and
 * emails a double opt-in confirmation link. The address receives no new-post
 * email until `confirmNewsletter` fires with the emailed token. All helpers
 * are imperative commands for onMounted / submit handlers — never
 * setup `useFetch` (see transport.ts notes).
 */

export interface NewsletterSubscribeResult {
	subscribed: boolean;
	message: string;
}

/** POST /api/newsletter/subscribe — record the address and (best effort) mail
 *  its double opt-in link. 202 regardless of prior state (no oracle).
 *  `digestWeekly` (false default, DEC-355/TASK-403) opts the address into the
 *  weekly digest instead of per-post mail once confirmed. */
export function subscribeNewsletter(
	email: string,
	digestWeekly = false,
): Promise<NewsletterSubscribeResult> {
	return command<NewsletterSubscribeResult>("/api/newsletter/subscribe", {
		method: "POST",
		body: { email, digest_weekly: digestWeekly },
	});
}

/** POST /api/newsletter/digest — flip one address's cadence between per-post
 *  mail and the weekly digest via its emailed token (DEC-355/TASK-403).
 *  200 idempotent; 404 for an unknown token (indistinguishable from a spam
 *  guess, mirroring confirm/unsubscribe). */
export function setNewsletterDigest(
	token: string,
	enabled: boolean,
): Promise<{ digest_weekly: boolean }> {
	return command<{ digest_weekly: boolean }>("/api/newsletter/digest", {
		method: "POST",
		body: { token, enabled },
	});
}

/** POST /api/newsletter/confirm — activate an address via its emailed token.
 *  200 idempotent; 404 for an unknown token (indistinguishable from a spam
 *  guess, mirroring reply-notify unsubscribe). `digest_weekly` reflects the
 *  address's real cadence so the confirm page can show it (DEC-355). */
export function confirmNewsletter(
	token: string,
): Promise<{ confirmed: boolean; digest_weekly: boolean }> {
	return command<{ confirmed: boolean; digest_weekly: boolean }>("/api/newsletter/confirm", {
		method: "POST",
		body: { token },
	});
}

/** POST /api/newsletter/unsubscribe — flip an address's consent off via its
 *  emailed token. 200 idempotent; 404 for an unknown token. */
export function unsubscribeNewsletter(token: string): Promise<{ unsubscribed: boolean }> {
	return command<{ unsubscribed: boolean }>("/api/newsletter/unsubscribe", {
		method: "POST",
		body: { token },
	});
}
