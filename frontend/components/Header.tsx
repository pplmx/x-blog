import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link href="/" className="text-2xl font-bold">
          Aurora
        </Link>
        <nav className="flex gap-6">
          <Link href="/" className="hover:text-blue-600">
            首页
          </Link>
          <Link href="/about" className="hover:text-blue-600">
            关于
          </Link>
        </nav>
      </div>
    </header>
  );
}