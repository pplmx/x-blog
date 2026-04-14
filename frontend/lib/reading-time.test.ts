import { describe, it, expect } from 'vitest';
import { calculateReadingTime, formatReadingTime } from './reading-time';

describe('calculateReadingTime', () => {
  it('should return at least 1 minute for empty content', () => {
    expect(calculateReadingTime('')).toBe(1);
  });

  it('should return at least 1 minute for short content', () => {
    expect(calculateReadingTime('测试')).toBe(1);
  });

  it('should calculate reading time for Chinese text', () => {
    // 400 Chinese characters = 1 minute
    const chinese400 = '中'.repeat(400);
    expect(calculateReadingTime(chinese400)).toBe(1);

    // 800 Chinese characters = 2 minutes
    const chinese800 = '中'.repeat(800);
    expect(calculateReadingTime(chinese800)).toBe(2);
  });

  it('should calculate reading time for English text', () => {
    // 400 English words = 1 minute (each word counted as 0.5)
    const english400 = 'word '.repeat(400).trim();
    expect(calculateReadingTime(english400)).toBe(1);
  });

  it('should handle mixed Chinese and English text', () => {
    // 200 Chinese chars + 400 English words = 200 + 200 = 400 chars = 1 minute
    const mixed = `${'中'.repeat(200)} ${'word '.repeat(400).trim()}`;
    expect(calculateReadingTime(mixed)).toBe(1);
  });

  it('should ignore markdown syntax', () => {
    const withCode = `${'中'.repeat(400)}\n\`\`\`python\nprint("hello")\n\`\`\``;
    const withoutCode = '中'.repeat(400);

    expect(calculateReadingTime(withCode)).toBe(calculateReadingTime(withoutCode));
  });

  it('should handle markdown links', () => {
    const withLinks = `${'中'.repeat(400)} [链接](https://example.com)`;
    const withoutLinks = `${'中'.repeat(400)} 链接`;

    expect(calculateReadingTime(withLinks)).toBe(calculateReadingTime(withoutLinks));
  });

  it('should handle markdown images', () => {
    const withImages = `${'中'.repeat(400)} ![图片](image.png)`;
    const withoutImages = '中'.repeat(400);

    expect(calculateReadingTime(withImages)).toBe(calculateReadingTime(withoutImages));
  });
});

describe('formatReadingTime', () => {
  it('should format reading time correctly', () => {
    expect(formatReadingTime(1)).toBe('1 分钟阅读');
    expect(formatReadingTime(5)).toBe('5 分钟阅读');
    expect(formatReadingTime(10)).toBe('10 分钟阅读');
  });

  it('should handle edge case of 0 minutes', () => {
    expect(formatReadingTime(0)).toBe('1 分钟阅读');
  });
});
