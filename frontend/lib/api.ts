import { Post, PostList } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchPosts(): Promise<PostList[]> {
  const res = await fetch(`${API_BASE}/api/posts`);
  if (!res.ok) throw new Error("Failed to fetch posts");
  return res.json();
}

export async function fetchPost(slug: string): Promise<Post> {
  const res = await fetch(`${API_BASE}/api/posts/${slug}`);
  if (!res.ok) throw new Error("Failed to fetch post");
  return res.json();
}