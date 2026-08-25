import { adminAuthHeaders } from "../auth";
import { command, query } from "../transport";

export interface AdminUser {
	id: number;
	username: string;
	role: "superuser" | "editor";
	is_superuser: boolean;
}

export interface CreateAdminUserInput {
	username: string;
	password: string;
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
