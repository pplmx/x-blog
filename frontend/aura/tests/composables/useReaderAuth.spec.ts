/** useReaderAuth composable tests (DEC-059, TASK-133). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readerLoginMock = vi.fn();
const readerLogin2FAMock = vi.fn();
const readerRegisterMock = vi.fn();
const completeEmailChangeMock = vi.fn();
const confirmPasswordResetMock = vi.fn();

vi.mock("~~/api/reader/auth", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../api/reader/auth")>();
	return {
		...actual,
		readerLogin: readerLoginMock,
		readerLogin2FA: readerLogin2FAMock,
		readerRegister: readerRegisterMock,
		completeEmailChange: completeEmailChangeMock,
		confirmPasswordReset: confirmPasswordResetMock,
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
	// Force the module-level singleton back to a known state so tests are
	// order-independent (isAuthenticated/reader persist across tests otherwise).
	useReaderAuth().logout();
	readerLoginMock.mockReset();
	readerLogin2FAMock.mockReset();
	readerRegisterMock.mockReset();
	completeEmailChangeMock.mockReset();
	confirmPasswordResetMock.mockReset();
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

/** A query() transport failure: `.data` carries the backend's parsed
 *  {"error":{"message":...}} envelope; `.message` is ofetch's technical string. */
function backendErr(technical: string, human: string, statusCode?: number) {
	const value: Record<string, unknown> = {
		message: technical,
		data: { error: { message: human } },
	};
	if (statusCode !== undefined) value.statusCode = statusCode;
	return {
		data: vi.fn(() => ({ value: null }))(),
		error: vi.fn(() => ({ value }))(),
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

	it("login falls back to 'Login failed' when the API sends no token and no error message", async () => {
		readerLoginMock.mockResolvedValue({ data: { value: null }, error: { value: null } });
		const { login } = useReaderAuth();
		await expect(login("r@example.com", "secret123")).rejects.toThrow("Login failed");
	});

	it("register rejects with the API's message", async () => {
		readerRegisterMock.mockResolvedValue(err("Email already registered"));
		const { register } = useReaderAuth();
		await expect(register("r@example.com", "secret123")).rejects.toThrow(
			"Email already registered",
		);
	});

	it("register falls back to 'Registration failed' when the error carries no message", async () => {
		readerRegisterMock.mockResolvedValue({
			data: { value: null },
			error: { value: { message: "" } },
		});
		const { register } = useReaderAuth();
		await expect(register("r@example.com", "secret123")).rejects.toThrow("Registration failed");
	});

	it("register falls back to 'Registration failed' when no token comes back", async () => {
		readerRegisterMock.mockResolvedValue({ data: { value: null }, error: { value: null } });
		const { register } = useReaderAuth();
		await expect(register("r@example.com", "secret123", "Riki")).rejects.toThrow(
			"Registration failed",
		);
	});

	it("updateToken stores token + profile and flips auth (DEC-067/TASK-141)", () => {
		const { updateToken, isAuthenticated, reader } = useReaderAuth();
		expect(isAuthenticated.value).toBe(false);

		updateToken(session);

		expect(isAuthenticated.value).toBe(true);
		expect(reader.value?.email).toBe("r@example.com");
		expect(localStorage.getItem("reader_token")).toBe("reader.jwt.token");
		expect(JSON.parse(localStorage.getItem("reader_profile") ?? "{}")).toMatchObject({
			id: 1,
			email: "r@example.com",
		});
	});

	it("login/logout keep working in-memory when localStorage is unavailable", async () => {
		// Environment without localStorage (denied storage / awkward SSR): the
		// composable must not crash and must still manage the in-memory state —
		// it just cannot persist anything.
		const originalLS = window.localStorage;
		Object.defineProperty(window, "localStorage", { value: undefined, configurable: true });
		try {
			readerLoginMock.mockResolvedValue(ok(session));
			const { isAuthenticated, reader, login, logout } = useReaderAuth();
			expect(isAuthenticated.value).toBe(false);

			await login("r@example.com", "secret123");

			expect(isAuthenticated.value).toBe(true);
			expect(reader.value?.email).toBe("r@example.com");
			// Nothing was persisted (and no read/write threw).
			expect(typeof (window as unknown as { localStorage: unknown }).localStorage).toBe(
				"undefined",
			);

			logout();
			expect(isAuthenticated.value).toBe(false);
			expect(reader.value).toBeNull();
		} finally {
			Object.defineProperty(window, "localStorage", { value: originalLS, configurable: true });
		}
	});

	it("a corrupted persisted profile reads as no profile instead of crashing", () => {
		localStorage.setItem("reader_token", "some.jwt");
		localStorage.setItem("reader_profile", "{not json");
		const { isAuthenticated, reader } = useReaderAuth();
		expect(isAuthenticated.value).toBe(true);
		expect(reader.value).toBeNull();
	});

	it("setProfile updates the in-memory profile and persists it without a token change", () => {
		const { isAuthenticated, reader, setProfile } = useReaderAuth();
		setProfile({ id: 2, email: "new@example.com", display_name: "Myst", created_at: null });

		expect(reader.value?.email).toBe("new@example.com");
		expect(isAuthenticated.value).toBe(false); // no token was touched
		expect(JSON.parse(localStorage.getItem("reader_profile") ?? "{}")).toMatchObject({
			id: 2,
			email: "new@example.com",
		});
		expect(localStorage.getItem("reader_token")).toBeNull();
	});

	it("a throwing localStorage write does not break login (in-memory session survives)", async () => {
		// Private-browsing quota / Safari third-party-storage block: setItem throws
		// even though hasLocalStorage() is true. The auth call already succeeded
		// server-side, so it must not fail — the session lives in-memory for the
		// tab (reader-auth deep-dive finding).
		readerLoginMock.mockResolvedValue(ok(session));
		const origSetItem = Storage.prototype.setItem;
		Storage.prototype.setItem = vi.fn(() => {
			throw new Error("QuotaExceededError");
		});
		try {
			const { isAuthenticated, reader, login } = useReaderAuth();
			await login("r@example.com", "secret123");
			expect(isAuthenticated.value).toBe(true);
			expect(reader.value?.email).toBe("r@example.com");
		} finally {
			Storage.prototype.setItem = origSetItem;
		}
	});

	describe("backend error envelope (deep-dive fix)", () => {
		// The backend wraps every rejection in {"error":{"message":...}}; query()
		// exposes it on the FetchError's `.data`, while `.message` is only the
		// technical "[POST] "...": 401 Unauthorized" string. The forms must show
		// the human text, not the ofetch noise.
		it("login surfaces the envelope's human message over the technical string", async () => {
			readerLoginMock.mockResolvedValue(
				backendErr(
					'[POST] "http://x/api/reader/login": 401 Unauthorized',
					"Incorrect email or password",
				),
			);
			const { isAuthenticated, login } = useReaderAuth();
			await expect(login("r@example.com", "wrong")).rejects.toThrow("Incorrect email or password");
			expect(isAuthenticated.value).toBe(false);
		});

		it("register surfaces the envelope's human message", async () => {
			readerRegisterMock.mockResolvedValue(
				backendErr('[POST] "http://x/api/reader/register": 422', "Email already registered"),
			);
			const { isAuthenticated, register } = useReaderAuth();
			await expect(register("r@example.com", "secret123", "Riki")).rejects.toThrow(
				"Email already registered",
			);
			expect(isAuthenticated.value).toBe(false);
		});

		it("login2FA surfaces the envelope's human message", async () => {
			readerLogin2FAMock.mockResolvedValue(
				backendErr('[POST] "http://x/api/reader/login/2fa": 401', "Invalid authentication code"),
			);
			const { login2FA } = useReaderAuth();
			await expect(login2FA("mfa-x", "000000")).rejects.toThrow("Invalid authentication code");
		});

		it("falls back to the technical message when no envelope body is present", async () => {
			readerLoginMock.mockResolvedValue(err("network layer error"));
			const { login } = useReaderAuth();
			await expect(login("r@example.com", "pw")).rejects.toThrow("network layer error");
		});
	});

	describe("resetPassword (DEC-286, TASK-371)", () => {
		it("redeems the token and adopts the rotated session via updateToken", async () => {
			confirmPasswordResetMock.mockResolvedValue(ok(session)).mockClear();
			const { isAuthenticated, reader, resetPassword } = useReaderAuth();
			await resetPassword("abc.def.ghi", "brandnew456");
			expect(confirmPasswordResetMock).toHaveBeenCalledWith({
				token: "abc.def.ghi",
				new_password: "brandnew456",
			});
			expect(isAuthenticated.value).toBe(true);
			expect(reader.value?.email).toBe("r@example.com");
			expect(localStorage.getItem("reader_token")).toBe("reader.jwt.token");
		});

		it("carries the human envelope message AND the business 400 status", async () => {
			confirmPasswordResetMock.mockResolvedValue(
				backendErr(
					'[POST] "http://x/api/reader/password-reset/confirm": 400',
					"Invalid or expired reset link",
					400,
				),
			);
			const { resetPassword } = useReaderAuth();
			const err = await resetPassword("spent", "brandnew456").catch((e: unknown) => e);
			expect((err as Error).message).toBe("Invalid or expired reset link");
			expect((err as { statusCode?: number }).statusCode).toBe(400);
		});
	});

	describe("confirmEmailChange (DEC-357, TASK-404)", () => {
		const rotated = {
			access_token: "rotated.jwt.token",
			token_type: "bearer",
			reader: { id: 1, email: "new@example.com", display_name: null, created_at: null },
		};

		it("adopts the fresh session from the emailed-link redemption", async () => {
			completeEmailChangeMock.mockResolvedValue(rotated);
			const { confirmEmailChange, isAuthenticated, reader } = useReaderAuth();
			expect(isAuthenticated.value).toBe(false);

			const res = await confirmEmailChange("abcd.efgh.ijkl");

			expect(completeEmailChangeMock).toHaveBeenCalledWith("abcd.efgh.ijkl");
			expect(res.reader.email).toBe("new@example.com");
			// The returned (rotated) session supersedes any stored one — the
			// version bump revoked every pre-change token.
			expect(isAuthenticated.value).toBe(true);
			expect(reader.value?.email).toBe("new@example.com");
			expect(localStorage.getItem("reader_token")).toBe("rotated.jwt.token");
		});

		it("preserves the business-level status on a spent/invalid link", async () => {
			// 400 = invalid / already-used / expired link — NOT a network
			// failure. The status must ride the rethrown error so the confirm
			// page can tell "spent link" from "outage" (round-342 review).
			const spent = Object.assign(new Error("Invalid or expired verification link"), {
				statusCode: 400,
			});
			completeEmailChangeMock.mockRejectedValue(spent);
			const { confirmEmailChange, isAuthenticated } = useReaderAuth();

			const err = await confirmEmailChange("spent.token").catch((e: unknown) => e);
			expect((err as { statusCode?: number }).statusCode).toBe(400);
			expect(isAuthenticated.value).toBe(false);
			expect(localStorage.getItem("reader_token")).toBeNull();
		});
	});

	describe("isStaleSession (dual-401 disambiguation, deep-dive)", () => {
		// The backend raises the SAME 401 status for a dead session (auth
		// dependency: "Could not validate credentials") and for an incorrect
		// current password (/me/password, /me/account: "Incorrect current
		// password"). A reader whose session expired must be sent back to
		// sign-in, not told their password is wrong.
		const { isStaleSession } = useReaderAuth();

		it("is false for non-401 failures", () => {
			expect(isStaleSession(new Error("network down"))).toBe(false);
			expect(isStaleSession({ statusCode: 500 })).toBe(false);
		});

		it("is true for an expired/revoked token 401 (credentials envelope message)", () => {
			// The REAL backend shape: the {"error":{"message":...}} envelope has
			// NO top-level `detail` (round-393 fix — the old test's
			// `_data: { detail }` shape never occurs).
			expect(
				isStaleSession({
					statusCode: 401,
					response: {
						status: 401,
						_data: { error: { message: "Could not validate credentials" } },
					},
				}),
			).toBe(true);
			// Dead-session envelope on `error.data` (command() surfaces the body
			// there too).
			expect(
				isStaleSession({
					statusCode: 401,
					data: { error: { message: "Could not validate credentials" } },
				}),
			).toBe(true);
			// No message at all → still a dead session (reader endpoints only
			// 401 for auth unless a business 401 is explicitly detailed).
			expect(isStaleSession({ statusCode: 401 })).toBe(true);
		});

		it("is false for a wrong-current-password 401 (business envelope message)", () => {
			expect(
				isStaleSession({
					statusCode: 401,
					response: { status: 401, _data: { error: { message: "Incorrect current password" } } },
				}),
			).toBe(false);
			// Same on `error.data`.
			expect(
				isStaleSession({
					statusCode: 401,
					data: { error: { message: "Incorrect current password" } },
				}),
			).toBe(false);
		});
	});
});

describe("two-factor login (round 364, DEC-401)", () => {
	const challenge = {
		access_token: null,
		token_type: null,
		reader: null,
		two_factor_required: true,
		mfa_token: "mfa-x",
	};

	it("holds at a 2FA challenge without storing a session", async () => {
		readerLoginMock.mockResolvedValue(ok({ ...challenge })).mockClear();
		const { isAuthenticated, reader, login } = useReaderAuth();
		const res = await login("r@example.com", "secret123");
		expect(res.two_factor_required).toBe(true);
		expect(res.mfa_token).toBe("mfa-x");
		// No session was adopted until the code is proven.
		expect(isAuthenticated.value).toBe(false);
		expect(reader.value).toBe(null);
	});

	it("login2FA exchanges the code for the real session", async () => {
		readerLogin2FAMock.mockResolvedValue(ok({ ...session })).mockClear();
		const { isAuthenticated, reader, login2FA } = useReaderAuth();
		await login2FA("mfa-x", "123456");
		expect(readerLogin2FAMock).toHaveBeenCalledWith({ mfa_token: "mfa-x", code: "123456" });
		expect(isAuthenticated.value).toBe(true);
		expect(reader.value?.email).toBe("r@example.com");
	});

	it("login2FA rejects when the API refuses the code", async () => {
		readerLogin2FAMock.mockResolvedValue(err("Invalid authentication code")).mockClear();
		const { isAuthenticated, login2FA } = useReaderAuth();
		await expect(login2FA("mfa-x", "000000")).rejects.toThrow("Invalid authentication code");
		expect(isAuthenticated.value).toBe(false);
	});
});
