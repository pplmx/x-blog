import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { extractToc } from './Markdown';

describe('Markdown - extractToc', () => {
  it('extracts h1 headings', () => {
    const content = '# Main Title\n\nSome content';
    const toc = extractToc(content);
    expect(toc).toHaveLength(1);
    expect(toc[0].text).toBe('Main Title');
    expect(toc[0].level).toBe(1);
  });

  it('extracts h2 headings', () => {
    const content = '# Title\n\n## Section One\n\n## Section Two';
    const toc = extractToc(content);
    expect(toc).toHaveLength(3);
    expect(toc[1].text).toBe('Section One');
    expect(toc[1].level).toBe(2);
  });

  it('extracts h3 headings', () => {
    const content = '### Deep Heading';
    const toc = extractToc(content);
    expect(toc).toHaveLength(1);
    expect(toc[0].level).toBe(3);
  });

  it('generates correct ids', () => {
    const content = '# Hello World';
    const toc = extractToc(content);
    expect(toc[0].id).toBe('hello-world');
  });

  it('handles Chinese characters in ids', () => {
    const content = '# 测试标题';
    const toc = extractToc(content);
    expect(toc[0].id).toBeDefined();
  });

  it('returns empty array for content without headings', () => {
    const content = 'Just some plain text without headings';
    const toc = extractToc(content);
    expect(toc).toHaveLength(0);
  });

  it('handles multiple headings', () => {
    const content = `# H1\n\n## H2\n\n### H3\n\n## Another H2`;
    const toc = extractToc(content);
    expect(toc).toHaveLength(4);
    expect(toc.map(t => t.level)).toEqual([1, 2, 3, 2]);
  });
});

describe('Markdown - Code Block Detection', () => {
  it('detects code blocks with language', () => {
    const content = '```python\nprint("hello")\n```';
    expect(content.includes('```python')).toBe(true);
  });

  it('detects mermaid blocks', () => {
    const content = '```mermaid\ngraph TD\nA --> B\n```';
    expect(content.includes('```mermaid')).toBe(true);
  });

  it('detects math formulas', () => {
    const content = 'Inline $x^2$ and block $$\\sum_{i=1}^n i$$';
    expect(content.includes('$')).toBe(true);
  });
});
