import { adminAuthHeaders } from "../auth";
import type { AuthorBrief } from "../contracts/shared";
import { command, query } from "../transport";

export interface AdminUser {
	id: number;
	username: string;
	role: "superuser" | "editor";
	is_superuser: boolean;
	/** Public pen name (DEC-359/TASK-405): the byline shown on published posts;
	 *  null means no public identity — the login username stays fully private
	 *  (admin login is no-oracle) but the author gets no byline/archive. */
	display_name?: string | null;
	/** Public "about this writer" bio (round 357): plain text rendered on the
	 *  author's /authors/{id} archive header; null until a superuser writes
	 *  one (whitespace-only folds to null, same as display_name). */
	bio?: string | null;
	/** Public profile picture (round 358): a /static URL after a superuser
	 *  uploads one (admin avatar endpoint), else absent. */
	avatar_url?: string | null;
}

export interface CreateAdminUserInput {
	username: string;
	password: string;
	/** Optional public pen name for the new account (whitespace-only -> none). */
	display_name?: string | null;
	/** Optional public "about this writer" bio (whitespace-only -> none). */
	bio?: string | null;
}

/** The signed-in admin's profile (id, username, role) — drives role-aware UI. */
export function useCurrentAdmin() {
	return query<AdminUser>("/api/admin/me", {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/** All admin accounts (superuser-only on the backend). */
export function useAdminUsers() {
	return query<AdminUser[]>("/api/admin/users", {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/** Pen-named admins for the post editor's author picker (DEC-359/TASK-406).
 *  Any admin can read this — exposing pen names leaks nothing (they already
 *  appear on public bylines) — which is exactly why editors can assign posts
 *  to another public writer without touching the superuser-only /users. */
export function useAdminAuthors() {
	return query<AuthorBrief[]>("/api/admin/authors", {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/** Provision a new admin account (superuser only). */
export function createAdminUser(data: CreateAdminUserInput): Promise<AdminUser> {
	return command<AdminUser>("/api/admin/users", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: data,
	});
}

/** Disable an admin account (superuser only; 404 for an unknown id). */
export function deleteAdminUser(id: number): Promise<void> {
	return command<void>(`/api/admin/users/${id}`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}

/** Upload (or replace) a writer's public profile picture (superuser only,
 *  round 358) — the face half of the admin/users identity row (pen name + bio
 *  + avatar). Same multipart shape as the reader avatar (DEC-299). */
export function uploadAdminUserAvatar(id: number, file: File): Promise<AdminUser> {
	const formData = new FormData();
	formData.append("file", file);
	return command<AdminUser>(`/api/admin/users/${id}/avatar`, {
		method: "POST",
		headers: adminAuthHeaders(),
		body: formData,
	});
}

/** Remove the writer's public profile picture (superuser only, round 358). */
export function removeAdminUserAvatar(id: number): Promise<AdminUser> {
	return command<AdminUser>(`/api/admin/users/${id}/avatar`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}

/** Edit an admin user's public pen name and "about this writer" bio
 *  (superuser only; DEC-359/TASK-405, bio round 357). An explicit
 *  `display_name: null` / `bio: null` clears that field. */
export function updateAdminUser(
	id: number,
	data: { display_name?: string | null; bio?: string | null },
): Promise<AdminUser> {
	return command<AdminUser>(`/api/admin/users/${id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: data,
	});
}
