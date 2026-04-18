export async function GET() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>X-Blog</ShortName>
  <Description>X-Blog - 探索技术世界，分享编程心得</Description>
  <Url type="text/html" template="${siteUrl}/search?q={searchTerms}"/>
  <Url type="application/rss+xml" template="${siteUrl}/rss.xml"/>
  <InputEncoding>UTF-8</InputEncoding>
  <OutputEncoding>UTF-8</OutputEncoding>
  <AdultContent>false</AdultContent>
  <Language>zh-CN</Language>
  <Image width="16" height="16">${siteUrl}/favicon.ico</Image>
</OpenSearchDescription>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
