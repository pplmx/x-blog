export default function Loading() {
  return (
    <div>
      {/* 搜索结果标题骨架 */}
      <div className="h-10 w-48 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-8" />

      {/* 文章卡片骨架 */}
      <div className="grid gap-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden bg-white dark:bg-gray-900 p-6 animate-pulse"
          >
            {/* 封面图骨架 */}
            <div className="h-32 bg-gradient-to-r from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-900 rounded-xl mb-4" />

            {/* 标题骨架 */}
            <div className="space-y-2 mb-4">
              <div className="h-6 w-3/4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
              <div className="h-6 w-1/2 bg-gray-50 dark:bg-gray-800/50 rounded animate-pulse" />
            </div>

            {/* 元信息骨架 */}
            <div className="flex items-center gap-4 mb-4">
              <div className="h-4 w-24 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
              <div className="h-4 w-16 bg-gray-50 dark:bg-gray-800/50 rounded animate-pulse" />
              <div className="h-4 w-20 bg-gray-50 dark:bg-gray-800/50 rounded animate-pulse ml-auto" />
            </div>

            {/* 摘要骨架 */}
            <div className="space-y-2">
              <div className="h-4 w-full bg-gray-50 dark:bg-gray-800/50 rounded animate-pulse" />
              <div className="h-4 w-2/3 bg-gray-50 dark:bg-gray-800/50 rounded animate-pulse" />
            </div>

            {/* 标签骨架 */}
            <div className="flex gap-2 mt-4">
              <div className="h-6 w-16 bg-gray-100 dark:bg-gray-800 rounded-full animate-pulse" />
              <div className="h-6 w-20 bg-gray-50 dark:bg-gray-800/50 rounded-full animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
