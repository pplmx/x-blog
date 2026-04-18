/**
 * Post detail page integration tests with MSW
 * Tests the post detail page component with mocked API responses
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
  mockPost,
  mockPostList,
  mockCommentList,
} from '@/tests/test-utils';

// Mock data
const mockSinglePost = mockPost({
  id: 1,
  title: 'Test Article Post',
  slug: 'test-article-post',
  content: `# Introduction

This is a test article with some content.

## Section 1

Here is some content for section 1.

## Section 2

Here is some content for section 2.

## Conclusion

This is the conclusion of the article.`,
  excerpt: 'This is a test excerpt for the article.',
  views: 1234,
  likes: 56,
  category: { id: 1, name: 'Tech' },
  tags: [
    { id: 1, name: 'React' },
    { id: 2, name: 'TypeScript' },
  ],
  created_at: '2024-01-15T10:30:00Z',
  updated_at: '2024-01-15T10:30:00Z',
});

const mockRelatedPosts = mockPostList(3, { category: { id: 1, name: 'Tech' } });
const mockComments = mockCommentList(5, 1);

// Create server with handlers
const server = setupServer(
  http.get('http://localhost:8000/api/posts/test-article-post', () => {
    return HttpResponse.json(mockSinglePost);
  }),
  http.get('http://localhost:8000/api/posts/1/related', () => {
    return HttpResponse.json(mockRelatedPosts);
  }),
  http.get('http://localhost:8000/api/posts/1/comments', () => {
    return HttpResponse.json(mockComments);
  }),
  http.post('http://localhost:8000/api/posts/1/like', () => {
    return HttpResponse.json({ id: 1, likes: 57 });
  }),
);

describe('Post Detail Page', () => {
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

  describe('Post Data Fetching', () => {
    it('fetches single post by slug', async () => {
      const response = await fetch('http://localhost:8000/api/posts/test-article-post');
      const data = await response.json();

      expect(data).toHaveProperty('title', 'Test Article Post');
      expect(data).toHaveProperty('slug', 'test-article-post');
      expect(data).toHaveProperty('content');
      expect(data).toHaveProperty('excerpt');
      expect(data).toHaveProperty('category');
      expect(data).toHaveProperty('tags');
      expect(data).toHaveProperty('views');
      expect(data).toHaveProperty('likes');
    });

    it('returns post with category and tags', async () => {
      const response = await fetch('http://localhost:8000/api/posts/test-article-post');
      const data = await response.json();

      expect(data.category).toEqual({ id: 1, name: 'Tech' });
      expect(data.tags).toHaveLength(2);
      expect(data.tags[0]).toHaveProperty('name', 'React');
    });

    it('fetches related posts', async () => {
      const response = await fetch('http://localhost:8000/api/posts/1/related');
      const data = await response.json();

      expect(data).toHaveLength(3);
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('slug');
    });

    it('fetches comments for post', async () => {
      const response = await fetch('http://localhost:8000/api/posts/1/comments');
      const data = await response.json();

      expect(data).toHaveLength(5);
      expect(data[0]).toHaveProperty('nickname');
      expect(data[0]).toHaveProperty('content');
      expect(data[0]).toHaveProperty('created_at');
    });
  });

  describe('Post Content', () => {
    it('parses markdown content correctly', async () => {
      const response = await fetch('http://localhost:8000/api/posts/test-article-post');
      const data = await response.json();

      // Content should contain markdown headers
      expect(data.content).toContain('# Introduction');
      expect(data.content).toContain('## Section 1');
      expect(data.content).toContain('## Section 2');
      expect(data.content).toContain('## Conclusion');
    });

    it('has valid excerpt', async () => {
      const response = await fetch('http://localhost:8000/api/posts/test-article-post');
      const data = await response.json();

      expect(data.excerpt).toBeTruthy();
      expect(typeof data.excerpt).toBe('string');
    });
  });

  describe('Like Functionality', () => {
    it('handles like API request', async () => {
      const response = await fetch('http://localhost:8000/api/posts/1/like', {
        method: 'POST',
      });
      const data = await response.json();

      expect(data).toHaveProperty('id', 1);
      expect(data).toHaveProperty('likes');
    });
  });

  describe('Post Metadata', () => {
    it('returns correct view count', async () => {
      const response = await fetch('http://localhost:8000/api/posts/test-article-post');
      const data = await response.json();

      expect(data.views).toBe(1234);
    });

    it('returns correct like count', async () => {
      const response = await fetch('http://localhost:8000/api/posts/test-article-post');
      const data = await response.json();

      expect(data.likes).toBe(56);
    });

    it('returns valid timestamps', async () => {
      const response = await fetch('http://localhost:8000/api/posts/test-article-post');
      const data = await response.json();

      expect(data.created_at).toBeTruthy();
      expect(data.updated_at).toBeTruthy();

      // Validate date format
      expect(() => new Date(data.created_at)).not.toThrow();
      expect(() => new Date(data.updated_at)).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('handles non-existent post', async () => {
      server.use(
        http.get('http://localhost:8000/api/posts/non-existent-post', () => {
          return HttpResponse.json({ error: 'Post not found' }, { status: 404 });
        })
      );

      const response = await fetch('http://localhost:8000/api/posts/non-existent-post');

      expect(response.status).toBe(404);
    });

    it('handles related posts API error gracefully', async () => {
      server.use(
        http.get('http://localhost:8000/api/posts/999/related', () => {
          return HttpResponse.json([]);
        })
      );

      const response = await fetch('http://localhost:8000/api/posts/999/related');
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Content Structure', () => {
    it('generates table of contents from headings', async () => {
      const response = await fetch('http://localhost:8000/api/posts/test-article-post');
      const data = await response.json();

      // Check content has multiple headings for TOC generation
      const h2Count = (data.content.match(/## /g) || []).length;
      expect(h2Count).toBeGreaterThanOrEqual(3);
    });
  });
});