/**
 * Dead-session guard for the reader follow controls on PUBLIC pages
 * (tags / categories / series). Survey finding: the follow-state GET and the
 * follow/notify toggles are reader-auth-scoped, but these pages are public —
 * so when the stored reader token has expired they used to render the follow
 * control as signed-in-but-broken: the state GET 401'd silently (resetting a
 * followed tag to "Follow"), and every tap 401'd into a transient "failed"
 * toast with no path back to sign-in. The account/notifications pages redirect
 * to /login in the same scenario; this page class needs the less disruptive
 * variant: drop the dead token and offer a sign-in prompt.
 *
 * The signed-in gate on those pages is localStorage token PRESENCE (not a
 * server round-trip), so calling logout() flips the follow control back to its
 * signed-out state automatically — the broken, always-failing button simply
 * disappears instead of failing forever.
 */
import { ref } from "vue";

import { useReaderAuth } from "./useReaderAuth";

export function useFollowSessionGuard() {
	const { logout, isStaleSession } = useReaderAuth();
	/** True once a follow/notify call proved the stored session is dead. */
	const sessionExpired = ref(false);

	/**
	 * React to a follow-state/toggle rejection. Returns true when the failure
	 * was a dead session (caller should skip its generic "failed" toast —
	 * the sign-in prompt shows instead); false for transient failures
	 * (offline/429/5xx — caller keeps its normal error surface).
	 */
	function guardFollowFailure(cause: unknown): boolean {
		if (isStaleSession(cause)) {
			logout();
			sessionExpired.value = true;
			return true;
		}
		return false;
	}

	return { sessionExpired, guardFollowFailure };
}
