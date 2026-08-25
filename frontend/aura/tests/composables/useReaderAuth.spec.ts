/** useReaderAuth composable tests (DEC-059, TASK-133). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readerLoginMock = vi.fn();
const readerRegisterMock = vi.fn();

vi.mock("~~/api/reader/auth", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../api/reader/auth")>();
	return {
		...actual,
		readerLogin: readerLoginMock,
		readerRegister: readerRegisterMock,
	};
});

import { useReaderAuth } from "../../composables/useReaderAuth";

const session = {
	access_token: "reader.jwt.token",
	token_type: "bearer",
	reader: { id: 1, email: "r@example.com", display_name: null, created_at: null },
};

beforeEach(() => {
	localStorage.clear();
	readerLoginMock.mockReset();
	readerRegisterMock.mockReset();
});

afterEach(() => {
	localStorage.clear();
});

function ok(v: unknown) {
	return { data: vi.fn(() => ({ value: v }))(), error: vi.fn(() => ({ value: null }))() };
}

function err(msg: string) {
	return {
		data: vi.fn(() => ({ value: null }))(),
		error: vi.fn(() => ({ value: { message: msg } }))(),
	};
}

describe("useReaderAuth", () => {
	it("is unauthenticated by default", () => {
		const { isAuthenticated } = useReaderAuth();
		expect(isAuthenticated.value).toBe(false);
	});

	it("login stores token + profile and flips auth state", async () => {
		readerLoginMock.mockResolvedValue(ok(session));
		const { isAuthenticated, reader, login } = useReaderAuth();

		await login("r@example.com", "secret123");

		expect(isAuthenticated.value).toBe(true);
		expect(reader.value?.email).toBe("r@example.com");
		expect(localStorage.getItem("reader_token")).toBe("reader.jwt.token");
	});

	it("login rejects on API error and keeps auth state false", async () => {
		readerLoginMock.mockResolvedValue(err("Incorrect email or password"));
		const { isAuthenticated, login } = useReaderAuth();

		await expect(login("r@example.com", "wrong")).rejects.toThrow("Incorrect");
		expect(isAuthenticated.value).toBe(false);
		expect(localStorage.getItem("reader_token")).toBeNull();
	});

	it("register stores token and returns reader", async () => {
		readerRegisterMock.mockResolvedValue(ok(session));
		const { isAuthenticated, register } = useReaderAuth();

		const res = await register("r@example.com", "secret123", "Riki");
		expect(res.reader.email).toBe("r@example.com");
		expect(isAuthenticated.value).toBe(true);
		expect(localStorage.getItem("reader_token")).toBe("reader.jwt.token");
	});

	it("logout clears the token and profile", async () => {
		readerLoginMock.mockResolvedValue(ok(session));
		const { login, logout, isAuthenticated, reader } = useReaderAuth();
		await login("r@example.com", "secret123");

		logout();

		expect(isAuthenticated.value).toBe(false);
		expect(reader.value).toBeNull();
		expect(localStorage.getItem("reader_token")).toBeNull();
	});

	it("isAuthenticated reflects a pre-existing token on a fresh call", () => {
		localStorage.setItem("reader_token", "saved.jwt.token");
		const { isAuthenticated } = useReaderAuth();
		expect(isAuthenticated.value).toBe(true);
	});
});
