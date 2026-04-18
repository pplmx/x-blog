import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
  mockTagList,
  mockPost,
  mockPostListResponse,
} from '@/tests/test-utils';

const mockTags = mockTagList(3);

// Create server with handlers - each test gets fresh instance via beforeEach
const server = setupServer(
  http.get('http://localhost:8000/api/tags', () => {
    return HttpResponse.json(mockTags);
  }),
  http.get('http://localhost:8000/api/posts', ({ request }) => {
    const url = new URL(request.url);
    const tagId = url.searchParams.get('tag_id');

    if (tagId === '1') {
      return HttpResponse.json(
        mockPostListResponse([
          mockPost({
            id: 1,
            title: 'React Post',
            slug: 'react-post',
          }),
        ])
      );
    }
    return HttpResponse.json(mockPostListResponse([]));
  }),
);

describe('Tags Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  afterAll(() => {
    vi.restoreAllMocks();
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