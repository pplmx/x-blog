/**
 * commentAuthorName unit tests.
 *
 * Guards the PII rule (TASK-377 class): a verified reader with no display_name
 * has their account email stamped as the comment's stored nickname (crud), so
 * ANY public rendering of a comment author must fall back to a generic identity
 * for such readers — never the email. Anonymous commenters' free-typed nicknames
 * are safe to show verbatim.
 */

import { describe, expect, it } from "vitest";

import { commentAuthorName } from "../../utils/commentAuthorName";

const READER_LABEL = "读者";

describe("commentAuthorName", () => {
	it("prefers a verified reader's display name", () => {
		expect(
			commentAuthorName({ reader: { display_name: "Ada" }, nickname: "Ada" }, READER_LABEL),
		).toBe("Ada");
	});

	it("masks a verified reader without a display_name instead of their email nickname", () => {
		// The backend stamps display_name-or-email as the nickname.
		expect(
			commentAuthorName(
				{ reader: { display_name: null }, nickname: "ada@example.com" },
				READER_LABEL,
			),
		).toBe("读者");
	});

	it("shows an anonymous commenter's free-typed nickname verbatim", () => {
		expect(commentAuthorName({ reader: null, nickname: "Guest One" }, READER_LABEL)).toBe(
			"Guest One",
		);
	});

	it("prefers the display name even when the stored nickname differs", () => {
		expect(
			commentAuthorName(
				{ reader: { display_name: "Grace" }, nickname: "grace@example.com" },
				READER_LABEL,
			),
		).toBe("Grace");
	});
});
