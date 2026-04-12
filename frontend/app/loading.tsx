export default function Loading() {
  return (
    <div className="flex flex-col lg:flex-row gap-8">
      <div className="flex-1">
        <div className="mb-8">
          <div className="h-9 w-40 bg-gray-200 rounded animate-pulse" />
          <div className="h-5 w-64 bg-gray-100 rounded animate-pulse mt-2" />
        </div>

        <div className="grid gap-6">
          {/* 模拟 3 个 PostCard 骨架 */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="border border-gray-100 rounded-2xl p-6 bg-white">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="space-y-2 flex-1">
                  <div className="h-6 w-3/4 bg-gray-200 rounded animate-pulse" />
                  <div className="h-6 w-1/2 bg-gray-100 rounded animate-pulse" />
                </div>
                <div className="w-5 h-5 bg-gray-100 rounded animate-pulse shrink-0" />
              </div>

              <div className="flex items-center gap-4 mb-4">
                <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
                <div className="h-5 w-20 bg-gray-50 rounded-full animate-pulse" />
                <div className="h-4 w-16 bg-gray-100 rounded animate-pulse ml-auto" />
              </div>

              <div className="h-4 bg-gray-100 rounded animate-pulse mb-4" />
              <div className="h-4 w-2/3 bg-gray-50 rounded animate-pulse mb-4" />

              <div className="flex gap-2 pt-2 border-t border-gray-50">
                <div className="h-6 w-16 bg-gray-100 rounded-full animate-pulse" />
                <div className="h-6 w-20 bg-gray-50 rounded-full animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 侧边栏骨架 */}
      <div className="hidden lg:block w-64 shrink-0 space-y-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-gradient-to-br from-gray-50 to-white rounded-2xl p-5 border border-gray-100"
          >
            <div className="h-5 w-20 bg-gray-200 rounded animate-pulse mb-4" />
            <div className="space-y-3">
              <div className="h-4 bg-gray-100 rounded animate-pulse" />
              <div className="h-4 bg-gray-50 rounded animate-pulse" />
              <div className="h-4 w-2/3 bg-gray-50 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
