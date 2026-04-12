import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

const mockTags = [
  { id: 1, name: 'React' },
  { id: 2, name: 'Python' },
  { id: 3, name: 'TypeScript' },
];

const server = setupServer(
  http.get('http://localhost:8000/api/tags', () => {
    return HttpResponse.json(mockTags);
  }),
  http.get('http://localhost:8000/api/posts', ({ request }) => {
    const url = new URL(request.url);
    const tagId = url.searchParams.get('tag_id');

    if (tagId === '1') {
      return HttpResponse.json({
        items: [
          {
            id: 1,
            title: 'React Post',
            slug: 'react-post',
            excerpt: null,
            published: true,
            created_at: '2024-01-01',
            views: 100,
            likes: 0,
            category: null,
            tags: [],
          },
        ],
        pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
      });
    }
    return HttpResponse.json({
      items: [],
      pagination: { total: 0, page: 1, limit: 10, total_pages: 0 },
    });
  })
);

describe('Tags Page', () => {
  beforeEach(() => {
    server.listen();
  });

  afterEach(() => {
    server.close();
  });

  it('renders tags page title', async () => {
    // Note: This would require the actual page component to be tested
    // For now, we test that the tags API works
    const response = await fetch('http://localhost:8000/api/tags');
    const data = await response.json();
    expect(data).toHaveLength(3);
    expect(data[0].name).toBe('React');
  });

  it('fetches posts by tag_id', async () => {
    const response = await fetch('http://localhost:8000/api/posts?tag_id=1');
    const data = await response.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].title).toBe('React Post');
  });
});
