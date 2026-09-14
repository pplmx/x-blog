import type { Ref } from "vue";
import { computed, ref } from "vue";

import { adminAuthHeaders } from "../auth";
import { command, query, withQuery } from "../transport";

/** One newsletter subscriber as the admin list serializes it (DEC-354). */
export interface AdminNewsletterSubscriber {
	id: number;
	email: string;
	is_confirmed: boolean;
	// True when the address chose the weekly digest instead of per-post mail
	// (DEC-355) — shown so an operator sees why a confirmed address is not in
	// the per-post fan-out.
	digest_weekly: boolean;
	created_at: string | null;
	confirmed_at: string | null;
}

export interface AdminNewsletterSubscriberListResponse {
	items: AdminNewsletterSubscriber[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		total_pages: number;
	};
}

export type AdminNewsletterStatus = "all" | "confirmed" | "pending";

/**
 * Admin newsletter subscriber list (reactive). `page` and `status` accept
 * refs so pagination/filter changes auto-refetch via useFetch path-watching —
 * the same pattern as useAdminReaders (DEC-189). `q` is a ref too; an empty
 * value is omitted so an unfiltered call stays q-free.
 */
export function useAdminNewsletterSubscribers(
	page: Ref<number> | number = ref(1),
	pageSize = 20,
	status: Ref<AdminNewsletterStatus> = ref<AdminNewsletterStatus>("all"),
	q: Ref<string> = ref(""),
) {
	// Accept a bare number like the readers/media siblings (coerce once) so a
	// non-reactive caller can't silently produce an undefined page param.
	const pageRef = typeof page === "number" ? ref(page) : page;
	const path = computed(() =>
		withQuery("/api/admin/newsletter/subscribers", {
			page: pageRef.value,
			limit: pageSize,
			status: status.value === "all" ? undefined : status.value,
			q: q.value.trim() || undefined,
		}),
	);
	return query<AdminNewsletterSubscriberListResponse>(path, {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/** Remove a newsletter subscriber (row + token) entirely. 204; 404 when gone. */
export function deleteNewsletterSubscriber(id: number): Promise<void> {
	return command<void>(`/api/admin/newsletter/subscribers/${id}`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}
