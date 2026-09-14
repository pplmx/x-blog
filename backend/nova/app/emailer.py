"""SMTP notification email delivery (DEC-197, TASK-217).

The reader notification stack (Web Push DEC-055 + durable inbox DEC-160 +
per-kind opt-outs DEC-171, tag-follow DEC-195) only reaches a reader while the
site is open or the browser grants push. Email is the off-site channel: a
reader who opts in for a kind gets a plain-text + HTML email to their
registered address whenever that event fires (new post in a followed
series/category/tag, a reply to their comment, a comment on a followed thread).

Configuration is lazy (per-call, not at import) exactly like webpush.py so
tests can vary it and a deployment without an ``SMTP_HOST`` simply never emails
(fails closed). Delivery is strictly best-effort: a notification path must
never break the triggering write (publish/comment) because mail failed, so
``dispatch_notification_emails`` never raises.

Email is a per-kind *opt-in* independent of the push/inbox toggles: a missing
prefs row reads as email-off (the email_* columns default false), so no reader
receives mail unless they explicitly switched a kind's email on. Subjects and
bodies reuse the exact zh strings from the durable inbox rows so a reader sees
a consistent story across channels. Every reader-controlled value (titles,
post titles) is HTML-escaped in the HTML part.
"""

import html
import logging
import os
import smtplib
import ssl
from collections.abc import Iterable
from dataclasses import dataclass
from email.message import EmailMessage

from sqlalchemy.orm import Session

from app import models
from app.auth import ReaderAccount

logger = logging.getLogger(__name__)

# Event kind -> email-pref column. series_new_part is a label refinement of
# new_post (ISS-114/DEC-181) and shares its email pref, mirroring how the
# push/inbox side gates both under the new_post opt-out.
_EMAIL_PREF_FOR_KIND: dict[str, str] = {
    "new_post": "email_new_post",
    "series_new_part": "email_new_post",
    "reply": "email_reply",
    "thread_comment": "email_thread_comment",
    "mention": "email_mention",
}


@dataclass(frozen=True)
class EmailItem:
    """One email to enqueue. ``kind`` selects the reader's email pref; the
    title/body/url are the same values the durable inbox row carries, so the
    channels agree."""

    reader_id: int
    kind: str
    title: str
    body: str
    url: str


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _is_en_site() -> bool:
    """True when the site is configured for English (SITE_LANGUAGE starts with
    "en"). The default zh-CN (or any non-en value) keeps today's Chinese copy.
    Lazy per-call like the other site config reads, so tests can vary it
    (DEC-342/TASK-397)."""
    return os.getenv("SITE_LANGUAGE", "").strip().lower().startswith("en")


def is_email_configured() -> bool:
    """True when an SMTP host is configured. Missing config fails closed: no
    SMTP host -> the fan-out skips email entirely (best effort, silent)."""
    return bool(_env("SMTP_HOST"))


def email_channel_enabled(pref: models.ReaderNotificationPref | None, kind: str) -> bool:
    """True when the reader opted into email for ``kind``.

    A missing prefs row reads False — the email_* columns default false, so
    email is strictly opt-in (unlike the all-on push/inbox prefs, where a
    missing row reads enabled).
    """
    col = _EMAIL_PREF_FOR_KIND.get(kind)
    if pref is None or col is None:
        return False
    return bool(getattr(pref, col, False))


def dispatch_notification_emails(db: Session, items: Iterable[EmailItem], logger) -> int:
    """Send the best-effort email copy of a notification fan-out.

    Gated on is_email_configured() and each reader's per-kind email opt-in plus
    a real registered address. Opens one SMTP session for all recipients.
    Returns how many messages SMTP accepted; never raises (callers are write
    paths that must not break on mail failure).
    """
    if not is_email_configured():
        return 0
    items = list(items)
    if not items:
        return 0
    try:
        by_reader: dict[int, list[EmailItem]] = {}
        for item in items:
            by_reader.setdefault(item.reader_id, []).append(item)
        if not by_reader:
            return 0

        # Email prefs + registered addresses in two batched queries (no N+1).
        # ReaderAccount keys readers by its own primary key (id), which is the
        # same value ReaderNotificationPref.reader_id stores.
        prefs = {
            row.reader_id: row
            for row in db.query(models.ReaderNotificationPref)
            .filter(models.ReaderNotificationPref.reader_id.in_(by_reader.keys()))
            .all()
        }
        addr_by_reader = {
            row[0]: row[1]
            for row in db.query(ReaderAccount.id, ReaderAccount.email)
            .filter(
                ReaderAccount.id.in_(by_reader.keys()),
                # A deactivated reader is a moderation action: they keep their
                # follow rows and prefs, but every notification channel must go
                # silent (the weekly digest already filters is_active — RIL
                # ISS-278, DEC-194). Without this, disabling an account still
                # left them receiving per-event mail.
                ReaderAccount.is_active.is_(True),
            )
            .all()
        }

        recipients: list[tuple[str, EmailItem]] = []
        for reader_id, addr in addr_by_reader.items():
            if not addr:
                continue
            for item in by_reader[reader_id]:
                if email_channel_enabled(prefs.get(reader_id), item.kind):
                    recipients.append((addr, item))
        if not recipients:
            return 0
        return _send_via_smtp(recipients)
    except Exception:  # noqa: BLE001 — best effort, never fail the caller
        logger.exception("notification email dispatch failed")
        return 0


def _send_via_smtp(recipients: list[tuple[str, EmailItem]]) -> int:
    """Deliver every per-event message over one SMTP session."""
    from_addr = _env("SMTP_FROM") or "no-reply@localhost"
    base_url = _env("SITE_URL") or "http://localhost:3000"
    messages = [_build_message(item, from_addr, addr, base_url) for addr, item in recipients]
    return send_messages(messages)


def send_messages(messages: Iterable[EmailMessage]) -> int:
    """Deliver prebuilt EmailMessages over one SMTP session (STARTTLS when configured).

    Shared by the per-event fan-out (`_send_via_smtp`) and the weekly digest
    (DEC-201, TASK-222) so both send through the single configured SMTP path.
    Returns how many messages the server accepted; a broken/missing config
    raises for the caller to swallow (the fan-out and digest both treat mail as
    best-effort).

    One recipient is refused (``SMTPRecipientsRefused``, e.g. a full mailbox)
    or a single message fails mid-session: that failure is skipped and the
    remaining recipients still get their mail, instead of one bad address
    aborting the whole batch — previously every recipient after the failure
    was silently dropped (RIL ISS-280). Connection-level errors still raise.
    """
    delivered = send_messages_flags(messages)
    return sum(delivered)


def send_messages_flags(messages: Iterable[EmailMessage]) -> list[bool]:
    """Like :func:`send_messages`, but returns a per-message accepted flag.

    Used by the weekly digest to stamp ``digest_sent_at`` per reader only after
    *that* message was accepted: with an all-or-nothing batch, messages sent
    before a mid-loop failure were delivered but no reader was stamped, so the
    next cron re-mailed everyone (duplicates, RIL ISS-280).
    """
    host = _env("SMTP_HOST")
    port = int(_env("SMTP_PORT") or 587)
    user = _env("SMTP_USER")
    password = _env("SMTP_PASSWORD")
    starttls = _env("SMTP_STARTTLS").lower() != "false"

    with smtplib.SMTP(host, port, timeout=15) as server:
        if starttls:
            server.starttls(context=ssl.create_default_context())
        if user:
            server.login(user, password)
        flags: list[bool] = []
        for msg in messages:
            try:
                server.send_message(msg)
                flags.append(True)
            except smtplib.SMTPRecipientsRefused:
                # A recipient-level refusal (full/dead mailbox, bad address)
                # drops only this message; the connection stays usable for the
                # rest of the batch (RFC 5321: RCPT TO failure is not fatal).
                logger.warning("SMTP refused a recipient in send_messages_flags")
                flags.append(False)
            except OSError:
                # A connection-level failure (server dropped the session) can't
                # be retried on this connection; stop rather than continue into
                # a broken session, and let the caller's best-effort handling
                # (digest idempotency / fan-out catch) decide.
                raise
        return flags


def _build_message(item: EmailItem, from_addr: str, to_addr: str, base_url: str) -> EmailMessage:
    """Compose a text + HTML message. ``url`` is an in-app relative deep link
    (as the inbox stores it); it becomes absolute here so email readers can follow it."""
    link = f"{base_url.rstrip('/')}{item.url}" if item.url else base_url
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = item.title
    msg.set_content(f"{item.title}\n\n{item.body}\n\n{link}")
    msg.add_alternative(
        f"<p><strong>{html.escape(item.title)}</strong></p>"
        f"<p>{html.escape(item.body)}</p>"
        f'<p><a href="{html.escape(link, quote=True)}">查看详情</a></p>',
        subtype="html",
    )
    return msg


def send_guest_reply_email(
    to_addr: str,
    *,
    post_title: str,
    reply_url: str,
    unsubscribe_url: str,
) -> bool:
    """Notify an ANONYMOUS commenter that a reply to their comment is live.

    ``dispatch_notification_emails`` is keyed to reader accounts and their
    per-kind email prefs — a guest has no account, so this is a direct SMTP
    send (mirrors ``send_password_reset_email``): built here, delivered through
    the single configured SMTP path, gated on ``is_email_configured()`` and
    best-effort (a mail failure must never break the comment approval that
    triggered it). The message carries the same deep link the reader push/inbox
    paths use plus a per-comment unsubscribe link so the guest's consent
    (DEC-332) stays revocable without an account. Returns whether SMTP accepted
    it; connection-level errors raise for the caller to swallow (best effort).
    """
    from_addr = _env("SMTP_FROM") or "no-reply@localhost"
    base_url = _env("SITE_URL") or "http://localhost:3000"
    link = f"{base_url.rstrip('/')}{reply_url}"
    unsubscribe = f"{base_url.rstrip('/')}{unsubscribe_url}"
    # Sender-side copy follows the site's configured language (DEC-342/TASK-397):
    # a guest has no account/locale, so SITE_LANGUAGE is the only signal; the
    # default zh copy is byte-for-byte today's text. The post title is
    # user-controlled, so escape it in the HTML part (already done via html.escape).
    if _is_en_site():
        subject = "Someone replied to your comment"
        text = (
            f"There is a new reply to your comment on {post_title}.\n"
            f"View the reply: {link}\n\n"
            f"If you no longer want these emails, click the link below to unsubscribe:\n{unsubscribe}"
        )
        html_body = (
            f"<p>There is a new reply to your comment on {html.escape(post_title)}.</p>"
            f'<p><a href="{html.escape(link, quote=True)}">View the reply</a></p>'
            f'<p><a href="{html.escape(unsubscribe, quote=True)}">Unsubscribe from these emails</a></p>'
        )
    else:
        subject = "有人回复了你的评论"
        text = (
            f"《{post_title}》有一条新回复。\n"
            f"查看回复：{link}\n\n"
            f"如果你不想再收到这类邮件，请点击下面的链接取消订阅：\n{unsubscribe}"
        )
        html_body = (
            f"<p>《{html.escape(post_title)}》有一条新回复。</p>"
            f'<p><a href="{html.escape(link, quote=True)}">查看回复</a></p>'
            f'<p><a href="{html.escape(unsubscribe, quote=True)}">取消订阅此类邮件</a></p>'
        )
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    flags = send_messages_flags([msg])
    return bool(flags and flags[0])


def send_password_reset_email(to_addr: str, reset_token: str) -> bool:
    """Send a reader's password-reset mail with its single-use reset link.

    The reset email is *not* part of the opt-in notification fan-out (it is a
    security-recovery delivery a reader explicitly requested), so it bypasses
    the per-kind pref gate and is sent straight through the configured SMTP
    path. Requires SMTP to be configured — the caller (the request endpoint)
    checks ``is_email_configured()`` first and maps a missing config to a 503 so
    the request never silently appears to succeed. Returns whether SMTP accepted
    the message (RFC errors -> False); connection-level errors raise, which the
    caller treats as a 503 (send failed) — in both cases the failure is an
    infrastructure condition, never account existence. (DEC-286, TASK-371)
    """
    from_addr = _env("SMTP_FROM") or "no-reply@localhost"
    base_url = _env("SITE_URL") or "http://localhost:3000"
    site_title = _env("SITE_TITLE") or "X-Blog"
    link = f"{base_url.rstrip('/')}/reset-password?token={reset_token}"
    # Recovery email follows the site's configured language + identity
    # (DEC-342/TASK-397): en sites get English copy, zh keeps today's copy, and
    # both use the configured SITE_TITLE instead of a hardcoded name.
    if _is_en_site():
        subject = f"Reset your {site_title} password"
        body = (
            f"We received a request to reset the password for your {site_title} account.\n"
            "Click the link below to set a new password (valid for 30 minutes, single use):\n\n"
            f"{link}\n\n"
            "If you didn't request a password reset, you can ignore this email — your password won't change."
        )
        html_body = (
            f"<p>We received a request to reset the password for your {html.escape(site_title)} account.</p>"
            "<p>Click the link below to set a new password (valid for 30 minutes, single use):</p>"
            f'<p><a href="{html.escape(link, quote=True)}">Set a new password</a></p>'
            "<p>If you didn't request a password reset, you can ignore this email — your password won't change.</p>"
        )
    else:
        subject = "重置密码 / Reset password"
        body = (
            f"我们收到了重置你 {site_title} 账号密码的请求。\n"
            "点击下面的链接设置新密码（30 分钟内有效，使用一次后失效）：\n\n"
            f"{link}\n\n"
            "如果你没有请求重置密码，请忽略这封邮件，你的密码不会被更改。"
        )
        html_body = (
            f"<p>我们收到了重置你 {html.escape(site_title)} 账号密码的请求。</p>"
            "<p>点击下面的链接设置新密码（30 分钟内有效，使用一次后失效）：</p>"
            f'<p><a href="{html.escape(link, quote=True)}">重新设置密码</a></p>'
            "<p>如果你没有请求重置密码，请忽略这封邮件，你的密码不会被更改。</p>"
        )
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(f"{subject}\n\n{body}")
    msg.add_alternative(html_body, subtype="html")
    flags = send_messages_flags([msg])
    return bool(flags and flags[0])


def send_newsletter_confirm_email(to_addr: str, token: str) -> bool:
    """Double opt-in confirmation for a guest newsletter subscription (DEC-351).

    ``subscribe`` only records the address and emails this confirm link — the
    address receives nothing (not even the confirmation's target) until the
    token link is clicked. Direct SMTP send (the guest has no reader account,
    so the prefs-gated ``dispatch_notification_emails`` does not apply),
    mirroring ``send_guest_reply_email``/``send_password_reset_email``: built
    here, delivered through the single configured SMTP path, gated on
    ``is_email_configured()`` (a missing config fails closed — separate from
    the endpoint's own error handling, which keeps subscribe a 202 no-oracle
    response). Site-language sender-side copy like the other guest emails
    (DEC-342). Returns whether SMTP accepted it; connection-level errors raise
    for the caller to swallow (best effort).
    """
    from_addr = _env("SMTP_FROM") or "no-reply@localhost"
    base_url = _env("SITE_URL") or "http://localhost:3000"
    site_title = _env("SITE_TITLE") or "X-Blog"
    link = f"{base_url.rstrip('/')}/newsletter/confirm?token={token}"
    if _is_en_site():
        subject = f"Confirm your {site_title} newsletter subscription"
        text = (
            f"You asked to receive an email whenever a new post is published on {site_title}.\n"
            "Click the link below to confirm (no confirmation, no emails):\n\n"
            f"{link}\n\n"
            "If you didn't ask for this, you can ignore this email — your address won't be used."
        )
        html_body = (
            f"<p>You asked to receive an email whenever a new post is published on {html.escape(site_title)}.</p>"
            '<p><a href="' + html.escape(link, quote=True) + '">Confirm my subscription</a></p>'
            "<p>If you didn't ask for this, you can ignore this email — your address won't be used.</p>"
        )
    else:
        subject = f"确认订阅 {site_title} 新文章通知"
        text = (
            f"你申请在 {site_title} 有新文章发布时收到邮件。\n"
            "点击下面的链接确认订阅（不确认则不会收到任何邮件）：\n\n"
            f"{link}\n\n"
            "如果你没有发起这个申请，请忽略这封邮件，你的邮箱不会被使用。"
        )
        html_body = (
            f"<p>你申请在 {html.escape(site_title)} 有新文章发布时收到邮件。</p>"
            '<p><a href="' + html.escape(link, quote=True) + '">确认订阅</a></p>'
            "<p>如果你没有发起这个申请，请忽略这封邮件，你的邮箱不会被使用。</p>"
        )
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(f"{subject}\n\n{text}")
    msg.add_alternative(html_body, subtype="html")
    flags = send_messages_flags([msg])
    return bool(flags and flags[0])


def _header_safe_title(title: str | None) -> str:
    """The post title as a safe email-header value.

    Email headers may not contain CR/LF (RFC 5322); Python's ``email`` package
    raises ``ValueError`` when a header value does, and ``Post.title`` is
    ``NonNulStr`` (NUL-only rejection) — so a title pasted/stored with a line
    break would otherwise make ``msg["Subject"] = ...`` raise inside the
    best-effort fan-out, turning a publish (or a public read that fires the
    scheduled-post sweep) into a 500. Both CR and LF collapse to an ASCII space
    for the Subject; the body/HTML keep the original title (a line break there
    is harmless text).
    """
    return (title or "").replace("\r", " ").replace("\n", " ")


def dispatch_newsletter_new_post(db: Session, post: models.Post, logger) -> int:
    """Email every confirmed newsletter subscriber once about a new post (DEC-351).

    Called at the same fan-out points that fire the new-post push/reader emails:
    after a write makes a post immediately visible and when a scheduled post
    crosses publish_at. Only ``is_confirmed`` rows (their double opt-in was
    completed) are emailed; pending rows stay silent. One SMTP session for all
    recipients, each message deep-linking to the post and carrying that
    subscriber's own unsubscribe link (``/newsletter/unsubscribe?token=...``)
    so consent stays revocable without an account (mirrors DEC-332). Returns
    how many messages SMTP accepted; never raises — a mail failure (or a
    title that a header can't carry) must never break the publish/fan-out that
    triggered it, so the whole build + send sits inside the catch.
    """
    if not is_email_configured():
        return 0
    try:
        subs = db.query(models.NewsletterSubscriber).filter(models.NewsletterSubscriber.is_confirmed.is_(True)).all()
        if not subs or not post.slug:
            return 0
        from_addr = _env("SMTP_FROM") or "no-reply@localhost"
        base_url = _env("SITE_URL") or "http://localhost:3000"
        site_title = _env("SITE_TITLE") or "X-Blog"
        post_url = f"{base_url.rstrip('/')}/posts/{post.slug}"
        header_title = _header_safe_title(post.title)
        messages: list[EmailMessage] = []
        for sub in subs:
            unsubscribe = f"{base_url.rstrip('/')}/newsletter/unsubscribe?token={sub.token}"
            if _is_en_site():
                subject = f"New post: {header_title}"
                text = (
                    f"A new post is live on {site_title}:\n\n{post.title}\n\n"
                    f"Read it: {post_url}\n\n"
                    f"If you no longer want these emails, click here to unsubscribe:\n{unsubscribe}"
                )
                html_body = (
                    "<p>A new post is live on "
                    + html.escape(site_title)
                    + ":</p>"
                    + f"<p><strong>{html.escape(post.title or '')}</strong></p>"
                    + '<p><a href="'
                    + html.escape(post_url, quote=True)
                    + '">Read the post</a></p>'
                    + '<p><a href="'
                    + html.escape(unsubscribe, quote=True)
                    + '">Unsubscribe from these emails</a></p>'
                )
            else:
                subject = f"新文章发布：{header_title}"
                text = (
                    f"{site_title} 发布了新文章：\n\n{post.title}\n\n"
                    f"阅读：{post_url}\n\n"
                    f"如果不想再收到这类邮件，请点击下面的链接取消订阅：\n{unsubscribe}"
                )
                html_body = (
                    f"<p>{html.escape(site_title)} 发布了新文章：</p>"
                    + f"<p><strong>{html.escape(post.title or '')}</strong></p>"
                    + '<p><a href="'
                    + html.escape(post_url, quote=True)
                    + '">阅读文章</a></p>'
                    + '<p><a href="'
                    + html.escape(unsubscribe, quote=True)
                    + '">取消订阅此类邮件</a></p>'
                )
            msg = EmailMessage()
            msg["From"] = from_addr
            msg["To"] = sub.email
            msg["Subject"] = subject
            msg.set_content(text)
            msg.add_alternative(html_body, subtype="html")
            messages.append(msg)
        if not messages:
            return 0
        return sum(send_messages_flags(messages))
    except Exception:  # noqa: BLE001 — best effort, never fail the caller
        logger.exception("newsletter new-post dispatch failed")
        return 0
