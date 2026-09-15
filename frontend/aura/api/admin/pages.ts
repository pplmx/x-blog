import { adminAuthHeaders } from "../auth";
import { command, query } from "../transport";

/** One static page as the admin manager lists it (round 347). */
export interface AdminPageRow {
	id: number;
	slug: string;
	title: string;
	published: boolean;
	created_at: string | null;
	updated_at: string | null;
}

/** Admin page detail: the row plus the full markdown body for editing. */
export interface AdminPageDetail extends AdminPageRow {
	content: string;
}

export interface AdminPageInput {
	slug: string;
	title: string;
	content: string;
	published: boolean;
}

/** Every page (drafts included, with bodies), newest-touched first — the
 *  manager list. The admin list includes content so the inline editor can
 *  start from what is saved (pages are few and admin-only). */
export function useAdminPages() {
	return query<AdminPageDetail[]>("/api/admin/pages", {
		headers: adminAuthHeaders(),
		server: false,
	});
}

export function createAdminPage(input: AdminPageInput): Promise<AdminPageDetail> {
	return command<AdminPageDetail>("/api/admin/pages", {
		method: "POST",
		headers: adminAuthHeaders(),
		body: JSON.stringify(input),
	});
}

export function updateAdminPage(
	id: number,
	patch: Partial<AdminPageInput>,
): Promise<AdminPageDetail> {
	return command<AdminPageDetail>(`/api/admin/pages/${id}`, {
		method: "PATCH",
		headers: adminAuthHeaders(),
		body: JSON.stringify(patch),
	});
}

export function deleteAdminPage(id: number): Promise<void> {
	return command<void>(`/api/admin/pages/${id}`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}
