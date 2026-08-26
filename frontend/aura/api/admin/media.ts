import type { UploadFileInfo, UploadListResponse } from "../contracts/media";
import { adminAuthHeaders } from "../auth";
import { query, withQuery, command } from "../transport";

/** Admin media library listing (reactive; newest first). */
export function useAdminMedia(page = 1, pageSize = 60) {
	return query<UploadListResponse>(
		withQuery("/api/upload/files", { page, page_size: pageSize }),
		{
			headers: adminAuthHeaders(),
			server: false,
		},
	);
}

// `/static/uploads/YYYY/MM/<uuid>.<ext>` — the canonical delete path is derived
// from the URL, not from the unpacked ints: month is zero-padded in the storage
// dir (2026/08/...) while the API surfaces `month` as an int (8), so a URL like
// 2026/8/... would 400 the backend's strict path regex (DEC-183 e2e caught it).
const UPLOAD_URL_RE = /^\/static\/uploads\/(\d{4})\/(\d{2})\/([0-9a-f-]{36}\.[a-z]+)$/;

/** Delete one uploaded image. Rejects with 409 while posts still embed it. */
export function deleteAdminMediaFile(urlOrItem: UploadFileInfo | string): Promise<{ message: string }> {
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
