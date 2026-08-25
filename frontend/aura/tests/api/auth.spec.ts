import { afterEach, describe, expect, it, vi } from "vitest";

import { adminAuthHeaders, readerAuthHeaders } from "../../api/auth.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("readerAuthHeaders", () => {
	it("returns a bearer header from the browser reader token", () => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn((key: string) => (key === "reader_token" ? "reader-secret" : null)),
		});

		expect(readerAuthHeaders()).toEqual({ Authorization: "Bearer reader-secret" });
	});

	it("returns empty headers during SSR", () => {
		vi.stubGlobal("window", undefined);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn(() => "reader-secret"),
		});

		expect(readerAuthHeaders()).toEqual({});
	});

	it("returns empty headers for a partial localStorage implementation", () => {
		vi.stubGlobal("localStorage", {});

		expect(readerAuthHeaders()).toEqual({});
	});

	it("never reads the admin token", () => {
		const getItem = vi.fn((key: string) => (key === "admin_token" ? "admin-secret" : null));
		vi.stubGlobal("localStorage", { getItem });

		expect(readerAuthHeaders()).toEqual({});
		expect(getItem).toHaveBeenCalledWith("reader_token");
		expect(getItem).not.toHaveBeenCalledWith("admin_token");
	});
});

describe("adminAuthHeaders", () => {
	it("returns a bearer header from the browser admin token", () => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn((key: string) => (key === "admin_token" ? "admin-secret" : null)),
		});

		expect(adminAuthHeaders()).toEqual({ Authorization: "Bearer admin-secret" });
	});

	it("returns empty headers when localStorage is unavailable", () => {
		vi.stubGlobal("localStorage", undefined);

		expect(adminAuthHeaders()).toEqual({});
	});

	it("never reads the reader token", () => {
		const getItem = vi.fn((key: string) => (key === "reader_token" ? "reader-secret" : null));
		vi.stubGlobal("localStorage", { getItem });

		expect(adminAuthHeaders()).toEqual({});
		expect(getItem).toHaveBeenCalledWith("admin_token");
		expect(getItem).not.toHaveBeenCalledWith("reader_token");
	});
});
