'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Filter, X, FolderOpen, Tag as TagIcon } from 'lucide-react';

interface Category {
  id: number;
  name: string;
}

interface Tag {
  id: number;
  name: string;
}

interface MobileFilterBarProps {
  categories: Category[];
  tags: Tag[];
}

export default function MobileFilterBar({ categories, tags }: MobileFilterBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  const currentCategory = searchParams.get('category_id');
  const currentTag = searchParams.get('tag_id');
  const hasFilters = currentCategory || currentTag;

  const clearFilters = () => {
    router.push('/');
    setIsOpen(false);
  };

  const getActiveCategoryName = () => {
    if (!currentCategory) return null;
    const cat = categories.find((c) => c.id === parseInt(currentCategory));
    return cat?.name;
  };

  const getActiveTagName = () => {
    if (!currentTag) return null;
    const tag = tags.find((t) => t.id === parseInt(currentTag));
    return tag?.name;
  };

  return (
    <>
      {/* 触发按钮 */}
      <div className="lg:hidden flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {hasFilters ? (
            <span className="text-sm text-blue-600 dark:text-blue-400">
              筛选中: {getActiveCategoryName() || getActiveTagName()}
            </span>
          ) : (
            <span className="text-sm text-gray-500 dark:text-gray-400">全部文章</span>
          )}
        </div>
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-gray-50 dark:from-gray-800 to-white dark:to-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
        >
          <Filter className="w-4 h-4" />
          筛选
          {hasFilters && (
            <span className="w-2 h-2 bg-blue-500 rounded-full" />
          )}
        </button>
      </div>

      {/* 筛选面板 */}
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <div
            className="fixed inset-0 bg-black/50 z-50 lg:hidden"
            onClick={() => setIsOpen(false)}
          />

          {/* 底部弹出面板 */}
          <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl max-h-[70vh] overflow-auto">
            {/* 头部 */}
            <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">筛选</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 清除筛选 */}
            {hasFilters && (
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                  清除所有筛选
                </button>
              </div>
            )}

            <div className="p-5 space-y-6">
              {/* 分类 */}
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  <FolderOpen className="w-4 h-4 text-purple-500" />
                  分类
                </h4>
                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <Link
                      key={cat.id}
                      href={`/?category_id=${cat.id}`}
                      onClick={() => setIsOpen(false)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                        currentCategory === String(cat.id)
                          ? 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-md'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 hover:text-purple-600'
                      }`}
                    >
                      {cat.name}
                    </Link>
                  ))}
                </div>
              </div>

              {/* 标签 */}
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  <TagIcon className="w-4 h-4 text-pink-500" />
                  标签
                </h4>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <Link
                      key={tag.id}
                      href={`/?tag_id=${tag.id}`}
                      onClick={() => setIsOpen(false)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                        currentTag === String(tag.id)
                          ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-pink-100 dark:hover:bg-pink-900/50 hover:text-pink-600'
                      }`}
                    >
                      #{tag.name}
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* 底部安全区域 */}
            <div className="h-6" />
          </div>
        </>
      )}
    </>
  );
}