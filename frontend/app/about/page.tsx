import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">关于 Aurora</h1>
      <div className="prose">
        <p>
          Aurora 是一个简单的博客系统，使用 FastAPI + Next.js 构建。
        </p>
        <p>
          后端采用 FastAPI + SQLAlchemy，提供 RESTful API。
          前端采用 Next.js 14 App Router，支持服务端渲染。
        </p>
        <p>
          <Link href="/" className="text-blue-600 hover:underline">
            返回首页
          </Link>
        </p>
      </div>
    </div>
  );
}