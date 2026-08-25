import { adminAuthHeaders } from "../auth";
import { command, query } from "../transport";

/** A runtime site setting (DEC-100, TASK-162). `value` is a canonical string
 *  ("true"/"false" for boolean settings). */
export interface SiteSetting {
	key: string;
	value: string;
}

/** Read a runtime site setting (reactive; meant for setup reads). */
export function useSiteSetting(key: string) {
	return query<SiteSetting>(`/api/admin/settings/${key}`, {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/**
 * Read a runtime site setting imperatively. The settings page reloads from a
 * client-only admin shell where `await useFetch` resolves before the data ref
 * arrives; awaiting the real response is deterministic (cf. ISS-097).
 */
export function getSiteSetting(key: string): Promise<SiteSetting> {
	return command<SiteSetting>(`/api/admin/settings/${key}`, {
		headers: adminAuthHeaders(),
	});
}

/** Persist a runtime site setting. */
export function updateSiteSetting(key: string, value: string): Promise<SiteSetting> {
	return command<SiteSetting>(`/api/admin/settings/${key}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: { value },
	});
}
