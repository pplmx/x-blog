import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ShareButtons from './ShareButtons';

describe('ShareButtons', () => {
  it('renders share buttons', () => {
    render(<ShareButtons title="测试文章" />);
    expect(screen.getByText('分享到')).toBeDefined();
  });

  it('renders weibo button', () => {
    render(<ShareButtons title="测试文章" />);
    const weiboButton = screen.getByTitle('分享到微博');
    expect(weiboButton).toBeDefined();
  });

  it('renders copy link button', () => {
    render(<ShareButtons title="测试文章" />);
    const copyButton = screen.getByTitle('复制链接');
    expect(copyButton).toBeDefined();
  });

  it('displays share text', () => {
    render(<ShareButtons title="测试文章" />);
    expect(screen.getByText(/分享到/)).toBeDefined();
  });
});
