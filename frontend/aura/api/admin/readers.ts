import type { Ref } from "vue";
import { computed, ref } from "vue";
import { adminAuthHeaders } from "../auth";
import type { AdminReaderStatus, AdminReadersResponse } from "../contracts/reader";
import { command, query, withQuery } from "../transport";

/** Admin readers list (reactive; newest-first by join date).
 *
 * `page` and `q` accept refs: the path is computed from their values so either
 * edit (pagination click, debounced search box) auto-refetches via useFetch's
 * path watching — the same pattern as the media library (DEC-189). `q` narrows
 * by email/display-name substring (case-insensitive, backend DEC-194); an
 * empty query is omitted so an unfiltered call stays q-free.
 */
export function useAdminReaders(page: Ref<number> | number = 1, pageSize = 20, q?: Ref<string>) {
	const pageRef = typeof page === "number" ? ref(page) : page;
	const qRef = q ?? ref("");
	const path = computed(() =>
		withQuery("/api/admin/readers", {
			page: pageRef.value,
			limit: pageSize,
			q: qRef.value.trim() || undefined,
		}),
	);
	return query<AdminReadersResponse>(path, {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/** Deactivate a reader account: blocks sign-in and revokes every live JWT. */
export function deactivateReader(id: number): Promise<AdminReaderStatus> {
	return command<AdminReaderStatus>(`/api/admin/readers/${id}/deactivate`, {
		method: "POST",
		headers: adminAuthHeaders(),
	});
}

/** Reactivate a deactivated reader account (the reader must log in again). */
export function activateReader(id: number): Promise<AdminReaderStatus> {
	return command<AdminReaderStatus>(`/api/admin/readers/${id}/activate`, {
		method: "POST",
		headers: adminAuthHeaders(),
	});
}
