/** Shape of an ofetch FetchError's response payload (behind the error's `.cause`). */
interface FetchErrorResponse {
	response?: { headers?: { get?: (name: string) => string | null } };
}

/**
 * Slug-change redirect (round 350).
 *
 * The admin editors let an operator re-slug posts, series and static pages;
 * the backend 404s the old URL (contract unchanged) but stamps the canonical
 * target on the response via an `X-Redirect-To` header. Call this right after
 * the page's data fetch resolves: on the server it emits a real 301 +
 * Location — so crawlers and link-shares land on the canonical URL instead of
 * a soft 404 — and on the client (an SPA click on a stale in-app link) it
 * hard-navigates there so the address bar reflects the new slug.
 *
 * Returns the target (or "") so callers can short-circuit.
 */
export function useSlugRedirect(
	error:
		| {
				statusCode?: number;
				response?: { headers?: { get?: (name: string) => string | null } };
				cause?: unknown;
		  }
		| null
		| undefined,
): string {
	if (error?.statusCode !== 404) return "";
	// The asyncData error re-shapes the fetch failure differently per side: the
	// server error keeps the original ofetch FetchError (with its response +
	// headers) under `.cause`, while the client keeps `.response` on the error
	// itself. Read both so the header survives either serialization.
	const source = ((error.cause as FetchErrorResponse | undefined)?.response ?? error.response) as
		| { headers?: { get?: (name: string) => string | null } }
		| undefined;
	const loc = source?.headers?.get?.("x-redirect-to") ?? "";
	if (!loc) return "";
	if (import.meta.server) {
		// Permanent, SEO-correct redirect emitted during SSR. setResponseStatus
		// has a no-event convenience overload; Location needs the raw event
		// because h3's setHeader(event, name, value) has no 2-arg shortcut.
		const event = useRequestEvent();
		if (!event) return "";
		setResponseStatus(event, 301);
		event.node.res.setHeader("Location", loc);
	} else {
		window.location.replace(loc);
	}
	return loc;
}
