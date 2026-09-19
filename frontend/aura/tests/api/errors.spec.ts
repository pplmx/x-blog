/** apiErrorMessage tests (round 394) — the shared backend-error surfacing used
 *  by the reader-auth composables and every admin list page. */

import { describe, expect, it } from "vitest";

import { apiErrorMessage } from "../../api/errors";

const FALLBACK = "操作失败，请重试";

describe("apiErrorMessage", () => {
	it("returns the backend envelope's human message over ofetch noise", () => {
		// command() surfaces the parsed {"error":{"message"}} body on `.data`;
		// the FetchError's own `.message` is the technical string.
		expect(
			apiErrorMessage(
				{
					message: '[POST] "http://localhost:18888/api/admin/pages": 500 Internal Server Error',
					statusCode: 500,
					data: { error: { message: "That slug is already in use" } },
				},
				FALLBACK,
			),
		).toBe("That slug is already in use");
	});

	it("never leaks ofetch's technical string for an HTTP error without a readable envelope", () => {
		expect(
			apiErrorMessage(
				{
					message: '[POST] "http://localhost:18888/api/comments/post/1": 429 Too Many Requests',
					statusCode: 429,
				},
				FALLBACK,
			),
		).toBe(FALLBACK);
	});

	it("preserves a local (non-HTTP) Error's own message", () => {
		expect(apiErrorMessage(new Error("client-side validation failed"), FALLBACK)).toBe(
			"client-side validation failed",
		);
	});

	it("falls back for a message-less failure", () => {
		expect(apiErrorMessage(new Error(""), FALLBACK)).toBe(FALLBACK);
		expect(apiErrorMessage(null, FALLBACK)).toBe(FALLBACK);
		expect(apiErrorMessage({ statusCode: 500 }, FALLBACK)).toBe(FALLBACK);
	});

	it("treats a status-carrying error as HTTP even without statusCode", () => {
		// Some ofetch shapes carry `.status` instead of `.statusCode`.
		expect(apiErrorMessage({ status: 403, message: "[POST] ... 403 Forbidden" }, FALLBACK)).toBe(
			FALLBACK,
		);
	});
});
