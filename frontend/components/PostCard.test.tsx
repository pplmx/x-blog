import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PostCard from "./PostCard";
import { PostList } from "@/types";

const mockPost: PostList = {
  id: 1,
  title: "Test Post Title",
  slug: "test-post-title",
  excerpt: "This is a test excerpt for the post",
  published: true,
  created_at: "2024-01-15T10:00:00Z",
  category: { id: 1, name: "Test Category" },
  tags: [
    { id: 1, name: "tag1" },
    { id: 2, name: "tag2" },
  ],
};

describe("PostCard", () => {
  it("should render post title", () => {
    render(<PostCard post={mockPost} />);
    
    expect(screen.getByText("Test Post Title")).toBeDefined();
  });

  it("should render post excerpt", () => {
    render(<PostCard post={mockPost} />);
    
    expect(screen.getByText("This is a test excerpt for the post")).toBeDefined();
  });

  it("should render category when present", () => {
    render(<PostCard post={mockPost} />);
    
    expect(screen.getByText("Test Category")).toBeDefined();
  });

  it("should render all tags", () => {
    render(<PostCard post={mockPost} />);
    
    expect(screen.getByText("tag1")).toBeDefined();
    expect(screen.getByText("tag2")).toBeDefined();
  });

  it("should not render excerpt when null", () => {
    const postWithoutExcerpt: PostList = {
      ...mockPost,
      excerpt: null,
    };
    
    render(<PostCard post={postWithoutExcerpt} />);
    
    expect(screen.queryByText("This is a test excerpt")).toBeNull();
  });

  it("should not render category when null", () => {
    const postWithoutCategory: PostList = {
      ...mockPost,
      category: null,
    };
    
    render(<PostCard post={postWithoutCategory} />);
    
    expect(screen.queryByText("Test Category")).toBeNull();
  });

  it("should link to correct post page", () => {
    render(<PostCard post={mockPost} />);
    
    const link = screen.getByRole("link", { name: /test post title/i });
    expect(link.getAttribute("href")).toBe("/posts/test-post-title");
  });
});