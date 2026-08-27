import type { PaginationInfo } from "./shared";

/** One registered reader as surfaced on the admin readers list (DEC-194). */
export interface AdminReader {
	id: number;
	email: string;
	display_name: string | null;
	is_active: boolean;
	created_at: string | null;
	last_login_at: string | null;
	comment_count: number;
	bookmark_count: number;
}

export interface AdminReadersResponse {
	items: AdminReader[];
	pagination: PaginationInfo;
}

/** is_active state returned by deactivate/activate so the list patches in place. */
export interface AdminReaderStatus {
	id: number;
	email: string;
	is_active: boolean;
	last_login_at: string | null;
}
