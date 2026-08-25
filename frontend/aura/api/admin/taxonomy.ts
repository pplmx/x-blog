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
