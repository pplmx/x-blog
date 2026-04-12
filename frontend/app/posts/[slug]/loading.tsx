export default function Loading() {
  return (
    <article>
      <div className="h-6 w-24 bg-gray-200 rounded animate-pulse mb-6" />

      <header className="mb-8">
        <div className="h-12 w-3/4 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="flex items-center gap-4 mb-4">
          <div className="h-5 w-32 bg-gray-100 rounded animate-pulse" />
          <div className="h-6 w-24 bg-gray-50 rounded-full animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-6 w-16 bg-gray-100 rounded-full animate-pulse" />
          <div className="h-6 w-20 bg-gray-50 rounded-full animate-pulse" />
        </div>
      </header>

      {/* 模拟文章内容 */}
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-5/6 bg-gray-50 rounded animate-pulse" />
          </div>
        ))}
        <div className="h-4 w-3/4 bg-gray-50 rounded animate-pulse" />
      </div>

      {/* 评论区骨架 */}
      <div className="mt-12 pt-8 border-t">
        <div className="h-6 w-24 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse" />
                <div className="h-4 w-20 bg-gray-100 rounded animate-pulse" />
                <div className="h-3 w-16 bg-gray-50 rounded animate-pulse ml-auto" />
              </div>
              <div className="h-4 bg-gray-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* 评论表单骨架 */}
      <div className="mt-8">
        <div className="h-6 w-24 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          <div className="h-24 bg-gray-50 rounded-xl animate-pulse" />
          <div className="h-10 w-32 bg-gray-100 rounded-lg animate-pulse" />
        </div>
      </div>
    </article>
  );
}