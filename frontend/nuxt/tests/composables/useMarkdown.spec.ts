import { describe, it, expect } from 'vitest';
import { useMarkdown } from '~/composables/useMarkdown';

describe('useMarkdown debug', () => {
  it('HTML', () => {
    const r = useMarkdown('<p>Hello</p>');
    console.log('HTML segments:', JSON.stringify(r.segments));
    expect(r.segments.length).toBe(1);
  });

  it('code block', () => {
    const r = useMarkdown('```ts\nconst x = 42;\n```');
    console.log('Code segments:', JSON.stringify(r.segments));
    expect(r.segments.length).toBe(1);
  });

  it('image', () => {
    const r = useMarkdown('<img src="test.png" alt="img" />');
    console.log('Image segments:', JSON.stringify(r.segments));
    expect(r.segments.length).toBe(1);
  });

  it('mixed', () => {
    const r = useMarkdown('<p>Before</p>\n```ts\ncode\n```\n<p>After</p>');
    console.log('Mixed segments:', JSON.stringify(r.segments));
    expect(r.segments.length).toBe(3);
  });
});
