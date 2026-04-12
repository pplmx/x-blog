'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { X, TrendingUp, FolderOpen, Tag as TagIcon } from 'lucide-react';

interface Category {
  id: number;
  name: string;
}

interface Tag {
  id: number;
  name: string;
}

interface PostList {
  id: number;
  title: string;
  slug: string;
  views: number;
}

interface SidebarProps {
  categories: Category[];
  tags: Tag[];
  popularPosts?: PostList[];
}

export default function Sidebar({ categories, tags, popularPosts = [] }: SidebarProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const currentCategory = searchParams.get('category_id');
  const currentTag = searchParams.get('tag_id');

  const clearFilters = () => {
    router.push('/');
  };

  return (
    <aside className="w-64 shrink-0 space-y-6">
      {/* 清除筛选按钮 */}
      {(currentCategory || currentTag) && (
        <button 
          onClick={clearFilters} 
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors mb-2"
        >
          <X className="w-4 h-4" />
          清除筛选
        </button>
      )}

      {/* 热门文章 */}
      {popularPosts.length > 0 && (
        <div className="bg-gradient-to-br from-gray-50 to-white rounded-2xl p-5 border border-gray-100">
          <h3 className="flex items-center gap-2 font-bold text-gray-900 mb-4">
            <TrendingUp className="w-5 h-5 text-orange-500" />
            热门文章
          </h3>
          <div className="space-y-3">
            {popularPosts.map((post, index) => (
              <Link
                key={post.id}
                href={`/posts/${post.slug}`}
                className="group flex items-start gap-3 p-2 -mx-2 rounded-xl hover:bg-gray-100 transition-colors duration-200"
              >
                <span className="flex items-center justify-center w-6 h-6 bg-gradient-to-br from-orange-100 to-red-100 text-orange-600 text-xs font-bold rounded-full group-hover:from-orange-200 group-hover:to-red-200">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 group-hover:text-blue-600 transition-colors line-clamp-2">
                    {post.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {post.views} 次阅读
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 分类 */}
      <div className="bg-gradient-to-br from-gray-50 to-white rounded-2xl p-5 border border-gray-100">
        <h3 className="flex items-center gap-2 font-bold text-gray-900 mb-4">
          <FolderOpen className="w-5 h-5 text-purple-500" />
          分类
        </h3>
        <div className="space-y-1">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/?category_id=${cat.id}`}
              className={`block px-3 py-2 rounded-xl text-sm transition-all duration-200 ${
                currentCategory === String(cat.id) 
                  ? 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-md' 
                  : 'text-gray-600 hover:bg-gray-100 hover:text-purple-600'
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </div>
      </div>

      {/* 标签 */}
      <div className="bg-gradient-to-br from-gray-50 to-white rounded-2xl p-5 border border-gray-100">
        <h3 className="flex items-center gap-2 font-bold text-gray-900 mb-4">
          <TagIcon className="w-5 h-5 text-pink-500" />
          标签
        </h3>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/?tag_id=${tag.id}`}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                currentTag === String(tag.id)
                  ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gradient-to-r hover:from-pink-100 hover:to-rose-100 hover:text-pink-600'
              }`}
            >
              #{tag.name}
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}
