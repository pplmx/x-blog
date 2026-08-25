import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { getAdminCalendar } from "../../../api/admin/calendar";

let commandCalls: Array<{ path: string; options: Record<string, unknown> }>;

beforeEach(() => {
	commandCalls = [];
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "https://api.example.test" },
	}));
	vi.stubGlobal("$fetch", ((path: string, options: Record<string, unknown> = {}) => {
		commandCalls.push({ path, options });
		return Promise.resolve({});
	}) as Mock);
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => (key === "admin_token" ? "admin-jwt" : null),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("admin editorial calendar", () => {
	it("fetches a month imperatively with the admin headers", async () => {
		await getAdminCalendar("2026-08");

		expect(commandCalls[0].path).toBe("/api/admin/calendar?month=2026-08");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
	});

	it("URL-encodes the month query parameter", async () => {
		await getAdminCalendar("2026 08");

		expect(commandCalls[0].path).toBe("/api/admin/calendar?month=2026+08");
	});
});
