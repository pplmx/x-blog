import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CommentList from "./CommentList";

global.fetch = vi.fn();

const mockComments = [
  {
    id: 1,
    nickname: "Alice",
    content: "Great post!",
    created_at: "2024-01-01T10:00:00Z",
  },
  {
    id: 2,
    nickname: "Bob",
    content: "Thanks for sharing!",
    created_at: "2024-01-02T11:00:00Z",
  },
];

describe("CommentList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render loading state", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    render(<CommentList postId={1} />);

    expect(screen.getByText("加载中...")).toBeDefined();
  });

  it("should render comments when loaded", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve(mockComments),
    });

    render(<CommentList postId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeDefined();
      expect(screen.getByText("Bob")).toBeDefined();
      expect(screen.getByText("Great post!")).toBeDefined();
      expect(screen.getByText("Thanks for sharing!")).toBeDefined();
    });

    expect(screen.getByText("评论 (2)")).toBeDefined();
  });

  it("should render empty message when no comments", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve([]),
    });

    render(<CommentList postId={1} />);

    await waitFor(() => {
      expect(screen.getByText("暂无评论，快来抢沙发！")).toBeDefined();
    });
  });
});