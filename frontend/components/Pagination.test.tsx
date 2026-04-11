import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Pagination from "./Pagination";

describe("Pagination", () => {
  it("should not render when totalPages is 1 or less", () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} baseUrl="/" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("should render page numbers", () => {
    render(<Pagination currentPage={2} totalPages={5} baseUrl="/" />);
    
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("4")).toBeDefined();
    expect(screen.getByText("5")).toBeDefined();
  });

  it("should show previous button when not on first page", () => {
    render(<Pagination currentPage={2} totalPages={5} baseUrl="/" />);
    
    expect(screen.getByText("上一页")).toBeDefined();
  });

  it("should show next button when not on last page", () => {
    render(<Pagination currentPage={2} totalPages={5} baseUrl="/" />);
    
    expect(screen.getByText("下一页")).toBeDefined();
  });

  it("should not show previous button on first page", () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={5} baseUrl="/" />
    );
    
    expect(container.textContent).not.toContain("上一页");
  });

  it("should not show next button on last page", () => {
    const { container } = render(
      <Pagination currentPage={5} totalPages={5} baseUrl="/" />
    );
    
    expect(container.textContent).not.toContain("下一页");
  });

  it("should highlight current page", () => {
    render(<Pagination currentPage={3} totalPages={5} baseUrl="/" />);
    
    const page3 = screen.getByText("3");
    expect(page3.closest("a")?.className).toContain("bg-blue-600");
  });
});