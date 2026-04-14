import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import BackToTop from '@/components/BackToTop';

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
      </head>
      <body className={inter.className}>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 container mx-auto px-4 py-8">{children}</main>
            <Footer />
            <BackToTop />
          </div>
        </Providers>
      </body>
    </html>
  );
}
