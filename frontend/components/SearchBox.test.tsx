import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SearchBox from "./SearchBox";
import * as api from "@/lib/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  searchPosts: vi.fn(),
}));

describe("SearchBox", () => {
  it("should render search input", () => {
    render(<SearchBox />);
    
    const input = screen.getByPlaceholderText("搜索文章...");
    expect(input).toBeDefined();
  });

  it("should show input value when typed", () => {
    render(<SearchBox />);
    
    const input = screen.getByPlaceholderText("搜索文章...");
    fireEvent.change(input, { target: { value: "test query" } });
    
    expect((input as HTMLInputElement).value).toBe("test query");
  });
});