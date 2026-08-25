import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	changeReaderPassword,
	deleteReaderAccount,
	getReaderDataExport,
	updateReaderProfile,
	useCurrentReader,
} from "../../../api/reader/account.ts";

let queryCalls: Array<{ path: unknown; options: Record<string, unknown> }>;
let commandCalls: Array<{ path: string; options: Record<string, unknown> }>;

beforeEach(() => {
	queryCalls = [];
	commandCalls = [];
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "https://api.example.test" },
	}));
	vi.stubGlobal(
		"useFetch",
		vi.fn((path: unknown, options: Record<string, unknown> = {}) => {
			queryCalls.push({ path, options });
			return { data: null, error: null };
		}),
	);
	vi.stubGlobal("$fetch", ((path: string, options: Record<string, unknown> = {}) => {
		commandCalls.push({ path, options });
		return Promise.resolve({});
	}) as Mock);
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => (key === "reader_token" ? "reader-jwt" : null),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("reader account queries", () => {
	it("fetches the current reader reactively with the audience headers", () => {
		useCurrentReader();

		expect(queryCalls[0].path).toBe("/api/reader/me");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});
});

describe("reader account commands", () => {
	it("downloads the data export with reader headers", async () => {
		await getReaderDataExport();

		expect(commandCalls[0].path).toBe("/api/reader/me/export");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("updates the profile with a PATCH body", async () => {
		await updateReaderProfile({ display_name: "Ana" });

		expect(commandCalls[0].path).toBe("/api/reader/me");
		expect(commandCalls[0].options.method).toBe("PATCH");
		expect(commandCalls[0].options.body).toEqual({ display_name: "Ana" });
		expect(commandCalls[0].options.headers).toEqual({
			Authorization: "Bearer reader-jwt",
			"Content-Type": "application/json",
		});
	});

	it("changes the password posting the current + new password", async () => {
		await changeReaderPassword({ current_password: "old", new_password: "new" });

		expect(commandCalls[0].path).toBe("/api/reader/me/password");
		expect(commandCalls[0].options.method).toBe("POST");
		expect(commandCalls[0].options.body).toEqual({ current_password: "old", new_password: "new" });
	});

	it("deletes the account with the confirming password", async () => {
		await deleteReaderAccount("supersecret");

		expect(commandCalls[0].path).toBe("/api/reader/me/account");
		expect(commandCalls[0].options.method).toBe("DELETE");
		expect(commandCalls[0].options.body).toEqual({ password: "supersecret" });
	});
});
