import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import BackToTop from '@/components/BackToTop';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ImageLightboxProvider } from '@/components/ImageLightboxContext';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://x-blog.example.com'),
  title: {
    default: 'X-Blog - 探索技术世界',
    template: '%s | X-Blog',
  },
  description: 'X-Blog - 探索技术世界，分享编程心得、算法解读和项目实践经验',
  keywords: ['博客', '技术', '编程', '开发', '教程', 'React', 'Next.js', 'Python'],
  authors: [{ name: 'X-Blog' }],
  creator: 'X-Blog',
  publisher: 'X-Blog',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: 'X-Blog - 探索技术世界',
    description: 'X-Blog - 探索技术世界，分享编程心得、算法解读和项目实践经验',
    type: 'website',
    locale: 'zh_CN',
    siteName: 'X-Blog',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'X-Blog - 探索技术世界',
    description: 'X-Blog - 探索技术世界，分享编程心得、算法解读和项目实践经验',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  other: {
    'rss-feed': '/rss.xml',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="dark-theme-color" content="#0a0a0a" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        {/* SEO autodiscovery */}
        <link rel="alternate" type="application/rss+xml" title="X-Blog RSS Feed" href="/rss.xml" />
        <link
          rel="alternate"
          type="application/atom+xml"
          title="X-Blog Atom Feed"
          href="/atom.xml"
        />
        <link
          rel="search"
          type="application/opensearchdescription+xml"
          title="X-Blog Search"
          href="/opensearch.xml"
        />
      </head>
      <body className={inter.className}>
        <ImageLightboxProvider>
          <Providers>
            <ErrorBoundary>
              {/* Skip to main content (keyboard accessibility) */}
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-md focus:font-medium focus:shadow-lg"
              >
                跳转到主要内容
              </a>
              <div className="min-h-screen flex flex-col">
                <Header />
                <main
                  id="main-content"
                  className="flex-1 container mx-auto px-4 py-8"
                  tabIndex={-1}
                >
                  {children}
                </main>
                <Footer />
                <BackToTop />
              </div>
            </ErrorBoundary>
          </Providers>
        </ImageLightboxProvider>
      </body>
    </html>
  );
}
