import type { PaginationInfo } from "./shared";

/** One uploaded image in the admin media library (DEC-183). */
export interface UploadFileInfo {
	url: string;
	year: number;
	month: number;
	filename: string;
	size: number;
	width: number | null;
	height: number | null;
	uploaded_at: string;
	referenced: boolean;
	referencing_posts: { id: number; title: string }[];
}

export interface UploadListResponse {
	items: UploadFileInfo[];
	pagination: PaginationInfo;
}
