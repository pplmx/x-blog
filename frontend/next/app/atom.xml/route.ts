import { fetchPosts } from '@/lib/api';

export async function GET() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const { items: posts } = await fetchPosts({ limit: 50 });

  const entries = posts
    .map((post) => {
      const updated = post.updated_at
        ? new Date(post.updated_at).toISOString()
        : new Date(post.created_at).toISOString();
      const published = new Date(post.created_at).toISOString();
      return `  <entry>
    <title>${post.title}</title>
    <link href="${siteUrl}/posts/${post.slug}"/>
    <id>${siteUrl}/posts/${post.slug}</id>
    <updated>${updated}</updated>
    <published>${published}</published>
    <summary>${(post.excerpt || '').replace(/'/g, '&apos;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</summary>
  </entry>`;
    })
    .join('\n');

  const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>X-Blog</title>
  <link href="${siteUrl}"/>
  <link href="${siteUrl}/atom.xml" rel="self"/>
  <id>${siteUrl}/atom.xml</id>
  <subtitle>探索技术世界，分享编程心得</subtitle>
  <updated>${new Date().toISOString()}</updated>
${entries}
</feed>`;

  return new Response(atom, {
    headers: {
      'Content-Type': 'application/atom+xml',
    },
  });
}
