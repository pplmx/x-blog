import { fetchPosts } from "@/lib/api";

const siteUrl = "https://x-blog.example.com";

export async function GET() {
  const { items: posts } = await fetchPosts({ limit: 100 });
  
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${siteUrl}/about</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  ${posts.map((post) => `
  <url>
    <loc>${siteUrl}/posts/${post.slug}</loc>
    <lastmod>${post.created_at}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join("")}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
}