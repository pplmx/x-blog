import { adminAuthHeaders } from "../auth";
import type { Category, Tag } from "../contracts/shared";
import { command, query } from "../transport";

/** All categories for the admin (reactive; meant for setup reads). */
export function useAdminCategories() {
	return query<Category[]>("/api/admin/categories", {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/**
 * Imperative categories list (lifecycle-hook loader on the preview page) — the
 * imperative seam; a useFetch query called from onMounted silently never sends
 * (ISS-110/111/117/118/119, TASK-220), which left the preview's category badge
 * missing. Mirrors getReaderSeriesFollows.
 */
export function getAdminCategories(): Promise<Category[]> {
	return command<Category[]>("/api/admin/categories", {
		headers: adminAuthHeaders(),
	});
}

/** Create a category (auth required). */
export function createAdminCategory(name: string): Promise<Category> {
	return command<Category>("/api/admin/categories", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: { name },
	});
}

/** Rename a category (auth required). */
export function updateAdminCategory(id: number, name: string): Promise<Category> {
	return command<Category>(`/api/admin/categories/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: { name },
	});
}

/** Delete a category (auth required). */
export function deleteAdminCategory(id: number): Promise<void> {
	return command<void>(`/api/admin/categories/${id}`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}

/** All tags for the admin (reactive; meant for setup reads). */
export function useAdminTags() {
	return query<Tag[]>("/api/admin/tags", {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/** Imperative tags list for lifecycle-hook loaders — see getAdminCategories. */
export function getAdminTags(): Promise<Tag[]> {
	return command<Tag[]>("/api/admin/tags", {
		headers: adminAuthHeaders(),
	});
}

/** Create a tag (auth required). */
export function createAdminTag(name: string): Promise<Tag> {
	return command<Tag>("/api/admin/tags", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: { name },
	});
}

/** Rename a tag (auth required). */
export function updateAdminTag(id: number, name: string): Promise<Tag> {
	return command<Tag>(`/api/admin/tags/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: { name },
	});
}

/** Delete a tag (auth required). */
export function deleteAdminTag(id: number): Promise<void> {
	return command<void>(`/api/admin/tags/${id}`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}
