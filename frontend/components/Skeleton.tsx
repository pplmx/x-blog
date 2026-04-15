// Post list skeleton loader
export function PostListSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-6">
          <div className="animate-pulse space-y-4">
            {/* Title */}
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
            {/* Meta */}
            <div className="flex items-center gap-4">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
            </div>
            {/* Excerpt */}
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
            </div>
            {/* Tags */}
            <div className="flex gap-2">
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16" />
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Post detail skeleton
export function PostDetailSkeleton() {
  return (
    <article className="max-w-3xl mx-auto">
      <div className="animate-pulse space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-full" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
        </div>
        {/* Cover */}
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        {/* Content */}
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-4 bg-gray-200 dark:bg-gray-700 rounded"
              style={{ width: `${Math.random() * 30 + 70}%` }}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

// Sidebar skeleton
export function SidebarSkeleton() {
  return (
    <aside className="space-y-8">
      {/* Categories */}
      <div className="bg-white dark:bg-gray-900 rounded-lg p-4">
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-4" />
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
      {/* Tags */}
      <div className="bg-white dark:bg-gray-900 rounded-lg p-4">
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-16 mb-4" />
        <div className="flex flex-wrap gap-2 animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full w-16" />
          ))}
        </div>
      </div>
      {/* Popular posts */}
      <div className="bg-white dark:bg-gray-900 rounded-lg p-4">
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-4" />
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// Full page skeleton
export function PageSkeleton() {
  return (
    <div className="flex flex-col lg:flex-row gap-8">
      <div className="flex-1">
        <PostListSkeleton />
      </div>
      <div className="w-full lg:w-64 shrink-0">
        <SidebarSkeleton />
      </div>
    </div>
  );
}
