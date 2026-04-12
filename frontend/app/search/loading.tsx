export default function Loading() {
  return (
    <div>
      <div className="h-9 w-32 bg-gray-200 rounded animate-pulse mb-8" />
      
      <div className="grid gap-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="border border-gray-100 rounded-2xl p-6 bg-white"
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="space-y-2 flex-1">
                <div className="h-6 w-3/4 bg-gray-200 rounded animate-pulse" />
                <div className="h-6 w-1/2 bg-gray-100 rounded animate-pulse" />
              </div>
            </div>
            
            <div className="flex items-center gap-4 mb-4">
              <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
            </div>
            
            <div className="h-4 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-2/3 bg-gray-50 rounded animate-pulse mt-2" />
          </div>
        ))}
      </div>
    </div>
  );
}