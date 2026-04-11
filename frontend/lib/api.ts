import { Post, PostList, Category, Tag } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchPosts(filters?: {
  category_id?: number;
  tag_id?: number;
}): Promise<PostList[]> {
  const params = new URLSearchParams();
  if (filters?.category_id) params.set("category_id", String(filters.category_id));
  if (filters?.tag_id) params.set("tag_id", String(filters.tag_id));

  const query = params.toString();
  const url = query ? `${API_BASE}/api/posts?${query}` : `${API_BASE}/api/posts`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch posts");
  return res.json();
}

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/api/categories`);
  if (!res.ok) throw new Error("Failed to fetch categories");
  return res.json();
}

export async function fetchTags(): Promise<Tag[]> {
  const res = await fetch(`${API_BASE}/api/tags`);
  if (!res.ok) throw new Error("Failed to fetch tags");
  return res.json();
}

export async function fetchPost(slug: string): Promise<Post> {
  const res = await fetch(`${API_BASE}/api/posts/${slug}`);
  if (!res.ok) throw new Error("Failed to fetch post");
  return res.json();
}