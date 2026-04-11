import { fetchPost } from "@/lib/api";
import Markdown from "@/components/Markdown";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Tag } from "@/types";
import CommentList from "@/components/CommentList";
import CommentForm from "@/components/CommentForm";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  let post;
  try {
    post = await fetchPost(slug);
  } catch {
    return {};
  }

  return {
    title: post.title,
    description: post.excerpt || post.content.slice(0, 150),
    openGraph: {
      title: post.title,
      description: post.excerpt || post.content.slice(0, 150),
      type: "article",
      publishedTime: post.created_at,
      authors: ["X-Blog"],
      tags: post.tags.map((t: Tag) => t.name),
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt || post.content.slice(0, 150),
    },
  };
}

export default async function PostPage({ params }: PageProps) {
  const { slug } = await params;
  
  let post;
  try {
    post = await fetchPost(slug);
  } catch {
    notFound();
  }

  const date = new Date(post.created_at).toLocaleDateString("zh-CN");

  return (
    <article>
      <Link href="/" className="text-blue-600 hover:underline mb-6 inline-block">
        ← 返回首页
      </Link>
      
      <header className="mb-8">
        <h1 className="text-4xl font-bold mb-4">{post.title}</h1>
        <div className="text-gray-500">
          <span>{date}</span>
          {post.category && (
            <span className="ml-4 px-2 py-1 bg-gray-100 rounded text-sm">
              {post.category.name}
            </span>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          {post.tags.map((tag: Tag) => (
            <span
              key={tag.id}
              className="text-sm px-3 py-1 bg-blue-50 text-blue-600 rounded"
            >
              {tag.name}
            </span>
          ))}
        </div>
      </header>
      
      <Markdown content={post.content} />
      
      <CommentList postId={post.id} />
      <CommentForm postId={post.id} />
      
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": post.title,
            "description": post.excerpt || post.content.slice(0, 150),
            "datePublished": post.created_at,
            "author": {
              "@type": "Person",
              "name": "X-Blog"
            }
          })
        }}
      />
    </article>
  );
}