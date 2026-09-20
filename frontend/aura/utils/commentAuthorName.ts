/**
 * Best public display name for a comment's author — never the account email.
 *
 * The backend stamps a verified reader's comment `nickname` as
 * `reader.display_name or reader.email` (crud.create_comment). So an anonymous
 * commenter's free-typed nickname is safe to show verbatim, but a verified
 * reader WITHOUT a display_name must never fall back to their stored nickname —
 * that is their email address. A reader with no display_name renders as a
 * generic identity instead (the caller supplies the localized label).
 *
 * Mirrors the inline treatment CommentList uses; centralised because the same
 * rule now applies to the discussion feed, comment search results and the
 * reply-composer header, not just the thread (DEC-294/TASK-376/377).
 */
export function commentAuthorName(
	comment: { reader: { display_name: string | null } | null; nickname: string },
	readerNoNameLabel: string,
): string {
	if (comment.reader?.display_name) return comment.reader.display_name;
	if (comment.reader) return readerNoNameLabel;
	return comment.nickname;
}
