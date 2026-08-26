import type { Ref } from "vue";
import { computed, ref } from "vue";
import { adminAuthHeaders } from "../auth";
import type { UploadFileInfo, UploadListResponse } from "../contracts/media";
import { command, query, withQuery } from "../transport";

/** Admin media library listing (reactive; newest first).
 *
 * `page` and `q` accept refs: the listing path is computed from their values so
 * editing either (pagination click, debounced search box) auto-refetches via
 * useFetch's path watching. `q` narrows by filename substring (case-insensitive,
 * backend DEC-189) — empty is omitted so an unfiltered call stays q-free.
 */
export function useAdminMedia(page: Ref<number> | number = 1, pageSize = 60, q?: Ref<string>) {
	const pageRef = typeof page === "number" ? ref(page) : page;
	const qRef = q ?? ref("");
	const path = computed(() =>
		withQuery("/api/upload/files", {
			page: pageRef.value,
			page_size: pageSize,
			q: qRef.value.trim() || undefined,
		}),
	);
	return query<UploadListResponse>(path, {
		headers: adminAuthHeaders(),
		server: false,
	});
}

// `/static/uploads/YYYY/MM/<uuid>.<ext>` — the canonical delete path is derived
// from the URL, not from the unpacked ints: month is zero-padded in the storage
// dir (2026/08/...) while the API surfaces `month` as an int (8), so a URL like
// 2026/8/... would 400 the backend's strict path regex (DEC-183 e2e caught it).
const UPLOAD_URL_RE = /^\/static\/uploads\/(\d{4})\/(\d{2})\/([0-9a-f-]{36}\.[a-z]+)$/;

/** Delete one uploaded image. Rejects with 409 while posts still embed it. */
export function deleteAdminMediaFile(
	urlOrItem: UploadFileInfo | string,
): Promise<{ message: string }> {
	const url = typeof urlOrItem === "string" ? urlOrItem : urlOrItem.url;
	const match = UPLOAD_URL_RE.exec(url);
	if (!match) {
		return Promise.reject(new Error(`Invalid upload URL: ${url}`));
	}
	const [, year, month, filename] = match;
	return command<{ message: string }>(`/api/upload/files/${year}/${month}/${filename}`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}

/**
 * Delete many uploaded images at once (media bulk delete, DEC-191). The backend
 * is fail-closed: if any listed URL is still referenced by a post it 409s the
 * whole batch. Only unreferenced cards are selectable in the UI, so a real
 * batch is always clean — but referenced URLs stay a valid defensive 409.
 */
export function batchDeleteAdminMediaFiles(urls: string[]): Promise<{ deleted: number }> {
	return command<{ deleted: number }>("/api/upload/files/batch-delete", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: { urls },
	});
}
