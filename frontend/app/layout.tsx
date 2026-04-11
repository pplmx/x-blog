import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: {
    default: "X-Blog",
    template: "%s | X-Blog",
  },
  description: "X-Blog - 一个现代化的博客系统",
  metadataBase: new URL("https://x-blog.example.com"),
  openGraph: {
    title: "X-Blog",
    description: "X-Blog - 一个现代化的博客系统",
    type: "website",
    locale: "zh_CN",
  },
  twitter: {
    card: "summary_large_image",
    title: "X-Blog",
    description: "X-Blog - 一个现代化的博客系统",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh">
      <body>
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 container mx-auto px-4 py-8">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}