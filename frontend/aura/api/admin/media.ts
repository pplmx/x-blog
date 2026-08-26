import type { UploadListResponse } from "../contracts/media";
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

/** Delete one uploaded image. Rejects with 409 while posts still embed it. */
export function deleteAdminMediaFile(
	year: number,
	month: number,
	filename: string,
): Promise<{ message: string }> {
	return command<{ message: string }>(`/api/upload/files/${year}/${month}/${filename}`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}
