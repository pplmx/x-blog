import { fetchPosts, fetchCategories, fetchTags } from '@/lib/api';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://x-blog.example.com';

export async function GET() {
  const [{ items: posts }, categories, tags] = await Promise.all([
    fetchPosts({ limit: 500 }),
    fetchCategories(),
    fetchTags(),
  ]);

  const staticPages = [
    { loc: '', changefreq: 'daily', priority: '1.0' },
    { loc: '/about', changefreq: 'monthly', priority: '0.5' },
    { loc: '/tags', changefreq: 'weekly', priority: '0.6' },
    { loc: '/search', changefreq: 'monthly', priority: '0.4' },
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  ${staticPages
    .map(
      (page) => `
  <url>
    <loc>${siteUrl}${page.loc}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
    )
    .join('')}
  ${categories
    .map(
      (cat) => `
  <url>
    <loc>${siteUrl}/?category_id=${cat.id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`
    )
    .join('')}
  ${tags
    .map(
      (tag) => `
  <url>
    <loc>${siteUrl}/tags?tag_id=${tag.id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`
    )
    .join('')}
  ${posts
    .map(
      (post) => `
  <url>
    <loc>${siteUrl}/posts/${post.slug}</loc>
    <lastmod>${post.created_at.split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
    ${post.cover_image ? `<image:image>${post.cover_image}</image:image>` : ''}
  </url>`
    )
    .join('')}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
