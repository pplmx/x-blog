import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("http://localhost:8000/api/posts", () => {
    return HttpResponse.json({
      items: [
        {
          id: 1,
          title: "Mock Post",
          slug: "mock-post",
          excerpt: "This is a mock post",
          published: true,
          created_at: "2024-01-01T00:00:00Z",
          category: { id: 1, name: "Tech" },
          tags: [],
        },
      ],
      pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
    });
  }),

  http.get("http://localhost:8000/api/categories", () => {
    return HttpResponse.json([{ id: 1, name: "Tech" }]);
  }),

  http.get("http://localhost:8000/api/tags", () => {
    return HttpResponse.json([{ id: 1, name: "react" }]);
  }),

  http.get("http://localhost:8000/api/posts/:slug", () => {
    return HttpResponse.json({
      id: 1,
      title: "Mock Post",
      slug: "mock-post",
      content: "# Hello\n\nThis is mock content",
      excerpt: "Mock excerpt",
      published: true,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      category_id: 1,
      category: { id: 1, name: "Tech" },
      tags: [{ id: 1, name: "react" }],
    });
  }),
];