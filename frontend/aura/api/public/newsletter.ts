import { command } from "../transport";

/**
 * Guest email newsletter (DEC-351, TASK-401).
 *
 * An anonymous visitor subscribes with an email address; the backend replies
 * with one generic message regardless of whether the address is new, already
 * subscribed, or previously unsubscribed (no email-existence oracle), and
 * emails a double opt-in confirmation link. The address receives no new-post
 * email until `confirmNewsletter` fires with the emailed token. All three
 * helpers are imperative commands for onMounted / submit handlers — never
 * setup `useFetch` (see transport.ts notes).
 */

export interface NewsletterSubscribeResult {
	subscribed: boolean;
	message: string;
}

/** POST /api/newsletter/subscribe — record the address and (best effort) mail
 *  its double opt-in link. 202 regardless of prior state (no oracle). */
export function subscribeNewsletter(email: string): Promise<NewsletterSubscribeResult> {
	return command<NewsletterSubscribeResult>("/api/newsletter/subscribe", {
		method: "POST",
		body: { email },
	});
}

/** POST /api/newsletter/confirm — activate an address via its emailed token.
 *  200 idempotent; 404 for an unknown token (indistinguishable from a spam
 *  guess, mirroring reply-notify unsubscribe). */
export function confirmNewsletter(token: string): Promise<{ confirmed: boolean }> {
	return command<{ confirmed: boolean }>("/api/newsletter/confirm", {
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
