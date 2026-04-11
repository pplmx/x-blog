"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

interface Category {
  id: number;
  name: string;
}

interface Tag {
  id: number;
  name: string;
}

interface SidebarProps {
  categories: Category[];
  tags: Tag[];
}

export default function Sidebar({ categories, tags }: SidebarProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const currentCategory = searchParams.get("category_id");
  const currentTag = searchParams.get("tag_id");

  const clearFilters = () => {
    router.push("/");
  };

  return (
    <aside className="w-64 shrink-0">
      {(currentCategory || currentTag) && (
        <button
          onClick={clearFilters}
          className="mb-4 text-sm text-blue-600 hover:underline"
        >
          ← 清除筛选
        </button>
      )}

      <div className="mb-6">
        <h3 className="font-semibold mb-2">分类</h3>
        <div className="space-y-1">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/?category_id=${cat.id}`}
              className={`block px-2 py-1 rounded text-sm hover:bg-gray-100 ${
                currentCategory === String(cat.id) ? "bg-blue-100" : ""
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-2">标签</h3>
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/?tag_id=${tag.id}`}
              className={`px-2 py-1 rounded text-xs ${
                currentTag === String(tag.id)
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              {tag.name}
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}