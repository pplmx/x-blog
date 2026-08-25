import { expectTypeOf } from "vitest";

import { query } from "../../../api/transport";

interface PostFixture {
	id: number;
	title: string;
}

function assertQueryTypes() {
	// @ts-expect-error Query options must be an object, never a cache-key string.
	query<PostFixture>("/api/posts", "cache-key");

	const transformed = query("/api/posts", {
		transform: (post: PostFixture) => post.title,
	});
	expectTypeOf(transformed.data.value).toEqualTypeOf<string | undefined>();
}

void assertQueryTypes;
