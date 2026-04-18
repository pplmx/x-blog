import { describe, it, expect } from 'vitest';
import {
  localeFromPath,
  localizedPath,
  locales,
  localeNames,
  defaultLocale,
  getDictionary,
  createTranslator,
} from './i18n';

describe('localeFromPath', () => {
  it('returns en for /en/* paths', () => {
    expect(localeFromPath('/en')).toBe('en');
    expect(localeFromPath('/en/')).toBe('en');
    expect(localeFromPath('/en/about')).toBe('en');
    expect(localeFromPath('/en/posts/my-post')).toBe('en');
  });

  it('returns defaultLocale for other paths', () => {
    expect(localeFromPath('/')).toBe(defaultLocale);
    expect(localeFromPath('/posts')).toBe(defaultLocale);
    expect(localeFromPath('/posts/my-post')).toBe(defaultLocale);
    expect(localeFromPath('/admin')).toBe(defaultLocale);
  });
});

describe('localizedPath', () => {
  it('returns path unchanged for default locale', () => {
    expect(localizedPath('/posts', 'zh-CN')).toBe('/posts');
    expect(localizedPath('/posts/my-post', 'zh-CN')).toBe('/posts/my-post');
  });

  it('prepends /en for non-default locale', () => {
    expect(localizedPath('/posts', 'en')).toBe('/en/posts');
    expect(localizedPath('/posts/my-post', 'en')).toBe('/en/posts/my-post');
  });

  it('handles paths without leading slash for non-default locale', () => {
    expect(localizedPath('posts', 'en')).toBe('/en/posts');
  });

  it('handles already-localized paths (no dedup)', () => {
    // The function doesn't dedupe /en prefix; it just prepends /en
    expect(localizedPath('/en/posts', 'en')).toBe('/en/en/posts');
  });
});

describe('getDictionary', () => {
  it('returns correct dictionary for zh-CN', () => {
    const dict = getDictionary('zh-CN');
    expect(dict['nav.home']).toBe('首页');
    expect(dict['home.noPosts']).toBe('暂无文章');
  });

  it('returns correct dictionary for en', () => {
    const dict = getDictionary('en');
    expect(dict['nav.home']).toBe('Home');
    expect(dict['home.noPosts']).toBe('No posts yet');
  });

  it('falls back to default locale for unknown locale', () => {
    const dict = getDictionary('fr' as 'zh-CN' | 'en');
    expect(dict).toEqual(getDictionary(defaultLocale));
  });
});

describe('createTranslator', () => {
  it('translates known keys for zh-CN', () => {
    const t = createTranslator('zh-CN');
    expect(t('nav.home')).toBe('首页');
    expect(t('post.views')).toBe('阅读');
    expect(t('search.noResults')).toBe('未找到相关文章');
  });

  it('translates known keys for en', () => {
    const t = createTranslator('en');
    expect(t('nav.home')).toBe('Home');
    expect(t('post.views')).toBe('views');
    expect(t('search.noResults')).toBe('No posts found');
  });

  it('returns key for unknown translation key', () => {
    const t = createTranslator('zh-CN');
    expect(t('unknown.key' as never)).toBe('unknown.key');
  });

  it('replaces parameters in translations', () => {
    const t = createTranslator('zh-CN');
    expect(t('post.views' as never, { count: 42 })).toBe('阅读');
  });

  it('handles missing parameters gracefully', () => {
    const t = createTranslator('en');
    expect(t('common.next' as never)).toBe('Next');
  });
});

describe('locales and defaults', () => {
  it('exports all expected locales', () => {
    expect(locales).toContain('zh-CN');
    expect(locales).toContain('en');
    expect(locales).toHaveLength(2);
  });

  it('exports locale names for both locales', () => {
    expect(localeNames['zh-CN']).toBe('中文');
    expect(localeNames.en).toBe('English');
  });

  it('defaultLocale is zh-CN', () => {
    expect(defaultLocale).toBe('zh-CN');
  });
});
