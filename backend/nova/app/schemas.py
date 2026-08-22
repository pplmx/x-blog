import re
from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Slug pattern: lowercase alphanumerics joined by single hyphens. Free-form
# slugs with spaces/&/CJK produce broken RSS/Atom/sitemap URLs and can never
# be matched by the public /posts/{slug_or_id} route.
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

_ALLOWED_COVER_SCHEMES = {"http", "https"}


def _validate_cover_image_url(value: str | None) -> str | None:
    """Reject dangerous cover_image URLs (e.g. javascript:) — issue #20.

    Allowed: empty string/None (clears the field), relative paths (the upload
    endpoint returns /static/uploads/...), and absolute http(s) URLs.
    """
    if value is None:
        return value
    # Reject protocol-relative URLs (//host/...) — urlparse yields scheme ""
    # so they'd slip past the scheme check and produce malformed sitemap image
    # URLs ({site_url}//host/...) while pointing the page at an external host.
    if value.startswith("//"):
        raise ValueError("cover_image must be an absolute http(s) URL or a /static/... path")
    parsed = urlparse(value)
    if parsed.scheme and parsed.scheme not in _ALLOWED_COVER_SCHEMES:
        raise ValueError("cover_image must be an absolute http(s) URL or a /static/... path")
    return value


class TagBase(BaseModel):
    # max_length 50 matches the Tag.name VARCHAR(50) column (issue #20 debt).
    # Without it, over-length input stores fine on SQLite but raises an
    # uncaught DataError -> 500 on PostgreSQL.
    name: str = Field(max_length=50)


class TagCreate(TagBase):
    pass


class Tag(TagBase):
    id: int
    post_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class CategoryBase(BaseModel):
    # max_length 50 matches the Category.name VARCHAR(50) column.
    name: str = Field(max_length=50)


class CategoryCreate(CategoryBase):
    pass


class Category(CategoryBase):
    id: int
    post_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class SeriesBrief(BaseModel):
    """Lightweight series reference embedded in post payloads (id + identity).

    Standalone (not a Series serialization) so a Post payload doesn't drag in
    the full series/post-list recursion (TASK-121).
    """

    id: int
    title: str
    slug: str
    model_config = ConfigDict(from_attributes=True)


class SeriesPublic(BaseModel):
    """Public series summary (list view): identity + visible post count."""

    id: int
    title: str
    slug: str
    description: str | None = None
    post_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class SeriesDetail(SeriesPublic):
    """Public series detail: the series plus its ordered, visible posts."""

    posts: list[PostList] = []


class SeriesCreate(BaseModel):
    # max_length 200 matches the Series VARCHAR(200) title/slug columns.
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(max_length=200, pattern=SLUG_PATTERN.pattern)
    description: str | None = Field(default=None, max_length=2000)


class SeriesUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=200, pattern=SLUG_PATTERN.pattern)
    description: str | None = None


class PostBase(BaseModel):
    # max_length values match the Post VARCHAR columns (title/slug 200,
    # excerpt/cover_image 500) so PostgreSQL rejects over-length input with
    # 422 instead of an uncaught DataError -> 500.
    title: str = Field(max_length=200)
    slug: str = Field(max_length=200, pattern=SLUG_PATTERN.pattern)
    content: str
    excerpt: str | None = Field(default=None, max_length=500)
    published: bool = False
    pinned: bool = False
    publish_at: datetime | None = None
    category_id: int | None = None
    series_id: int | None = None
    series_order: int = 0
    cover_image: str | None = Field(default=None, max_length=500)


class PostCreate(PostBase):
    tags: list[str] = []

    @field_validator("cover_image")
    @classmethod
    def check_cover_image_scheme(cls, value: str | None) -> str | None:
        return _validate_cover_image_url(value)


class PostUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    # Same pattern as PostBase.slug so updates can't introduce broken
    # feed/sitemap URLs (issue debt #7). None = "don't update the field".
    slug: str | None = Field(default=None, max_length=200, pattern=SLUG_PATTERN.pattern)
    content: str | None = None
    excerpt: str | None = Field(default=None, max_length=500)
    published: bool | None = None
    pinned: bool | None = None
    publish_at: datetime | None = None
    category_id: int | None = None
    # series_id: int = assign/change, null = clear the series membership
    # (mirrors category_id semantics under model_dump(exclude_unset=True)).
    series_id: int | None = None
    series_order: int | None = None
    cover_image: str | None = Field(default=None, max_length=500)
    tag_ids: list[int] | None = None

    @field_validator("cover_image")
    @classmethod
    def check_cover_image_scheme(cls, value: str | None) -> str | None:
        return _validate_cover_image_url(value)


class Post(PostBase):
    id: int
    created_at: datetime
    updated_at: datetime
    views: int = 0
    likes: int = 0
    category: Category | None = None
    tags: list[Tag] = []
    series: SeriesBrief | None = None
    model_config = ConfigDict(from_attributes=True)


# CJK ranges (Han unified ideographs + extension A + compatibility) count as one
# "word" each — they carry a syllable per character and text has no spaces, so
# a whitespace split would otherwise collapse an entire Chinese post to ~1 word.
_CJK_RE = re.compile(r"[\u2e80-\u2eff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
# Markdown/punctuation chars stripped before word counting (kept in sync with
# the detail-page formula in posts/[slug].vue).
_MD_STRIP_RE = re.compile(r"[#*`\n]")


def reading_minutes(content: str | None) -> int:
    """Estimate reading time in minutes from Markdown content.

    CJK-aware: whitespace-separated tokens plus each CJK character count as one
    word (~200 wpm), so Chinese/Japanese posts without spaces are not collapsed
    to a 1-minute read. Mirrors the formula in `posts/[slug].vue` so list cards
    and the detail page agree on article length.
    """
    if not content:
        return 1
    text = _MD_STRIP_RE.sub(" ", content)
    tokens = text.split()
    # Words = non-CJK whitespace tokens + each CJK character (syllable-length).
    cjk_chars = sum(len(_CJK_RE.findall(t)) for t in tokens)
    non_cjk_words = sum(1 for t in tokens if not _CJK_RE.search(t))
    words = non_cjk_words + cjk_chars
    return max(1, round(words / 200))


class PostList(BaseModel):
    id: int
    title: str
    slug: str
    excerpt: str | None
    snippet: str | None = None
    published: bool
    pinned: bool = False
    created_at: datetime
    views: int = 0
    likes: int = 0
    comment_count: int = 0
    reading_time: int = 1
    cover_image: str | None = None
    category: Category | None = None
    tags: list[Tag] = []
    series: SeriesBrief | None = None
    series_order: int = 0
    model_config = ConfigDict(from_attributes=True)


class PaginationMeta(BaseModel):
    total: int
    page: int
    limit: int
    total_pages: int


class PostListResponse(BaseModel):
    items: list[PostList]
    pagination: PaginationMeta


class ArchiveEntry(BaseModel):
    """A single (year, month) bucket with its post count, for the archive index."""

    year: int
    month: int
    count: int


class AdjacentPosts(BaseModel):
    """Linear prev/next navigation for a post, in feed order.

    `previous` is the post immediately before the current one in the public
    feed (pinned desc, created_at desc); `next` is the one immediately after.
    Either may be None at the ends of the feed.
    """

    previous: PostList | None = None
    next: PostList | None = None


class CommentBase(BaseModel):
    # max_length values match the Comment VARCHAR columns (nickname 50,
    # email 100) so over-length input is rejected with 422 instead of an
    # uncaught DataError -> 500 on PostgreSQL. email is intentionally NOT here:
    # only CommentCreate requires it (anonymous submissions), while the read
    # schemas (Comment/CommentPublic) either carry it back from the DB row
    # (full Comment, nullable for readers) or drop it entirely (CommentPublic
    # drops PII). Keeps the schemas free of conflicting overrides.
    nickname: str = Field(max_length=50)
    # Bounded so the public, unauthenticated comment endpoint cannot bloat the DB
    # / response with unbounded bodies (security audit round 16).
    content: str = Field(max_length=5000)


class CommentCreate(CommentBase):
    parent_id: int | None = None
    # Anonymous submissions must identify themselves; signed-in readers send a
    # placeholder (their identity is stamped from the JWT and this is ignored).
    # Column width 100 matches the VARCHAR (no DataError on PostgreSQL).
    email: str = Field(max_length=100)
    # Anti-spam honeypot: a hidden field real humans never see or fill, but
    # naive spam bots do. The frontend submits an empty string; any non-empty
    # value means the submitter is a bot, so the comment is rejected.
    website: str = ""

    @field_validator("website")
    @classmethod
    def check_honeypot(cls, value: str) -> str:
        if value:
            raise ValueError("Unexpected field")
        return value


class Comment(CommentBase):
    id: int
    post_id: int
    parent_id: int | None = None
    ip_address: str
    is_approved: bool = True
    # Comment upvote count (DEC-092/TASK-158); mirrored on CommentPublic.
    likes: int = 0
    created_at: datetime
    # Full row: reader-attributed comments store no free-text email (identity
    # is the account), anonymous comments keep theirs — nullable covers both.
    email: str | None = None
    # Reader-attributed identity (None for anonymous free-text commenters) —
    # mapped from the ORM comment.reader relationship (DEC-062).
    reader: CommentReaderProfile | None = None

    @field_validator("reader", mode="before")
    @classmethod
    def _map_reader(cls, reader):
        return comment_reader_profile(reader)

    model_config = ConfigDict(from_attributes=True)


class CommentReaderProfile(BaseModel):
    """Public reader identity attached to an attributed comment (DEC-062).

    Deliberately NO email — a comment's reader_id is verified (stamped from the
    reader JWT), but the account email is PII and must not ride a public
    comment list. display_name is the author-controlled, reader-facing handle.
    """

    id: int
    display_name: str | None = None


class CommentPostBrief(BaseModel):
    """Minimal post context for a comment-history item (navigation only)."""

    id: int
    title: str
    slug: str


def comment_reader_profile(reader) -> CommentReaderProfile | None:
    """Map a comment `reader` (ORM ReaderAccount | dict | None) to the profile.

    Shared by the Comment and CommentPublic schemas so a reader-attributed
    comment serializes the same profile shape wherever it appears. Accepts
    both an ORM row and an already-validated dict (the history endpoint
    re-validates via model_dump round-trip).
    """
    if reader is None:
        return None
    if isinstance(reader, dict):
        id_: int | None = reader.get("id") if isinstance(reader.get("id"), int) else None
        display_name = reader.get("display_name")
        if id_ is None:
            return None
        return CommentReaderProfile(id=id_, display_name=display_name)
    return CommentReaderProfile(id=reader.id, display_name=reader.display_name)


class CommentPublic(CommentBase):
    """Public-facing comment that omits PII (ip_address, email).

    The unauthenticated list endpoint returns this instead of the full
    ``Comment`` so a visitor cannot enumerate commenters' stored IP addresses
    or email addresses (both are collected for moderation/rate-limiting only).
    ``CommentBase`` still carries email for the write path (required on create);
    this schema drops it from the read response by re-declaring only the
    moderator-safe fields.
    """

    id: int
    post_id: int
    parent_id: int | None = None
    is_approved: bool = True
    # Comment upvote count (DEC-092/TASK-158): harmless on the public list,
    # unlike the PII fields dropped from this schema.
    likes: int = 0
    created_at: datetime
    # email is dropped from the public serialization entirely (PII); ip_address
    # is simply absent from this schema. Reader-attributed comments store no
    # free-text email (the account email is PII and stays off this schema).
    email: str | None = Field(default=None, exclude=True)
    # Reader-attributed identity (None for anonymous free-text commenters) —
    # mapped from the ORM comment.reader relationship (DEC-062).
    reader: CommentReaderProfile | None = None

    @field_validator("reader", mode="before")
    @classmethod
    def _map_reader(cls, reader):
        return comment_reader_profile(reader)

    model_config = ConfigDict(from_attributes=True)
