import { describe, it, expect, vi } from 'vitest';

// Test category/tag filtering
describe('Filtering Utilities', () => {
  it('filters posts by category', () => {
    const posts = [
      { id: 1, category: { id: 1, name: 'Tech' } },
      { id: 2, category: { id: 2, name: 'Life' } },
      { id: 3, category: { id: 1, name: 'Tech' } },
    ];

    const techPosts = posts.filter((p) => p.category.id === 1);
    expect(techPosts.length).toBe(2);
  });

  it('filters posts by tag', () => {
    const posts = [
      { id: 1, tags: [{ id: 1, name: 'React' }] },
      { id: 2, tags: [{ id: 2, name: 'Vue' }] },
      {
        id: 3,
        tags: [
          { id: 1, name: 'React' },
          { id: 3, name: 'TypeScript' },
        ],
      },
    ];

    const reactPosts = posts.filter((p) => p.tags.some((t) => t.name === 'React'));
    expect(reactPosts.length).toBe(2);
  });

  it('combines multiple filters', () => {
    const posts = [
      { id: 1, category: { id: 1 }, tags: [{ id: 1 }], published: true },
      { id: 2, category: { id: 2 }, tags: [{ id: 2 }], published: true },
      { id: 3, category: { id: 1 }, tags: [{ id: 1 }], published: false },
    ];

    const filtered = posts.filter((p) => p.category.id === 1 && p.published);
    expect(filtered.length).toBe(1);
  });
});

// Test pagination calculation
describe('Pagination Utilities', () => {
  const calculatePagination = (total: number, page: number, limit: number) => {
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;
    return { totalPages, hasNext, hasPrev };
  };

  it('calculates total pages correctly', () => {
    expect(calculatePagination(50, 1, 10).totalPages).toBe(5);
    expect(calculatePagination(51, 1, 10).totalPages).toBe(6);
    expect(calculatePagination(0, 1, 10).totalPages).toBe(0);
  });

  it('determines hasNext correctly', () => {
    expect(calculatePagination(50, 5, 10).hasNext).toBe(false);
    expect(calculatePagination(50, 4, 10).hasNext).toBe(true);
  });

  it('determines hasPrev correctly', () => {
    expect(calculatePagination(50, 1, 10).hasPrev).toBe(false);
    expect(calculatePagination(50, 2, 10).hasPrev).toBe(true);
  });
});

// Test slug generation
describe('Slug Utilities', () => {
  const generateSlug = (title: string): string => {
    return title
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  it('generates basic slug', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
  });

  it('handles chinese characters', () => {
    const result = generateSlug('测试标题');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles multiple spaces', () => {
    expect(generateSlug('Multiple   Spaces')).toBe('multiple-spaces');
  });

  it('removes special characters', () => {
    expect(generateSlug('Test @#$% Post')).toBe('test-post');
  });
});

// Test validation utilities
describe('Validation Utilities', () => {
  const isValidEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const isRequired = (value: string | undefined | null): boolean => {
    return value !== undefined && value !== null && value.trim() !== '';
  };

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  it('validates email format correctly', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('invalid')).toBe(false);
    expect(isValidEmail('invalid@')).toBe(false);
    expect(isValidEmail('@domain.com')).toBe(false);
  });

  it('validates required fields', () => {
    expect(isRequired('test')).toBe(true);
    expect(isRequired('')).toBe(false);
    expect(isRequired('   ')).toBe(false);
    expect(isRequired(undefined)).toBe(false);
    expect(isRequired(null)).toBe(false);
  });

  it('validates URL format', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://test.com/path')).toBe(true);
    expect(isValidUrl('invalid')).toBe(false);
  });
});

// Test date utilities
describe('Date Utilities', () => {
  it('formats date to locale string', () => {
    const date = new Date('2024-01-15T10:00:00Z');
    const formatted = date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    expect(formatted).toContain('2024');
  });

  it('calculates days difference', () => {
    const now = new Date();
    const past = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const diffMs = now.getTime() - past.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(2);
  });

  it('handles future dates', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(future.getTime()).toBeGreaterThan(now.getTime());
  });
});

// Test array utilities
describe('Array Utilities', () => {
  it('removes duplicates by id', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }];
    const unique = items.filter(
      (item, index, self) => index === self.findIndex((t) => t.id === item.id)
    );
    expect(unique.length).toBe(3);
  });

  it('groups items by property', () => {
    const items = [
      { category: 'A', name: '1' },
      { category: 'B', name: '2' },
      { category: 'A', name: '3' },
    ];
    const grouped = items.reduce<Record<string, typeof items>>((acc, item) => {
      const key = item.category;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {});
    expect(Object.keys(grouped)).toContain('A');
    expect(grouped['A'].length).toBe(2);
  });

  it('sorts by multiple fields', () => {
    const items = [
      { priority: 2, date: '2024-01-01' },
      { priority: 1, date: '2024-01-02' },
      { priority: 1, date: '2024-01-01' },
    ];
    const sorted = [...items].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
    expect(sorted[0].priority).toBe(1);
  });
});

// Test object utilities
describe('Object Utilities', () => {
  it('picks specific keys', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const picked = Object.fromEntries(
      Object.entries(obj).filter(([key]) => key === 'a' || key === 'b')
    );
    expect(picked).toEqual({ a: 1, b: 2 });
    expect(picked.c).toBeUndefined();
  });

  it('omits specific keys', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const { c, ...rest } = obj;
    expect(rest).toEqual({ a: 1, b: 2 });
  });

  it('deep clones object', () => {
    const obj = { nested: { value: 1 } };
    const cloned = JSON.parse(JSON.stringify(obj));
    expect(cloned.nested.value).toBe(1);
    expect(cloned).not.toBe(obj);
  });
});

// Test string utilities
describe('String Utilities', () => {
  it('truncates string with ellipsis', () => {
    const truncate = (str: string, len: number) =>
      str.length > len ? `${str.slice(0, len)}...` : str;

    expect(truncate('hello world', 5)).toBe('hello...');
    expect(truncate('hi', 10)).toBe('hi');
  });

  it('capitalizes first letter', () => {
    const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

    expect(capitalize('hello')).toBe('Hello');
  });

  it('escapes HTML entities', () => {
    const escapeHtml = (str: string) =>
      str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
});
