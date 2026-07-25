'use client';

import Link from 'next/link';
import { Tag as TagIcon } from 'lucide-react';

interface Tag {
  id: number;
  name: string;
  post_count?: number;
}

interface TagCloudProps {
  tags: Tag[];
  maxFontSize?: number;
  minFontSize?: number;
}

export default function TagCloud({ tags, maxFontSize = 24, minFontSize = 12 }: TagCloudProps) {
  if (!tags || tags.length === 0) {
    return <div className="text-center py-4 text-gray-500 dark:text-gray-400">暂无标签</div>;
  }

  // Calculate font size based on post count
  const counts = tags.map((t) => t.post_count || 1);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);

  const getFontSize = (count: number) => {
    if (maxCount === minCount) return (maxFontSize + minFontSize) / 2;

    const ratio = (count - minCount) / (maxCount - minCount);
    return minFontSize + ratio * (maxFontSize - minFontSize);
  };

  // Generate colors for tags
  const colors = [
    'text-blue-600 dark:text-blue-400',
    'text-green-600 dark:text-green-400',
    'text-purple-600 dark:text-purple-400',
    'text-pink-600 dark:text-pink-400',
    'text-orange-600 dark:text-orange-400',
    'text-cyan-600 dark:text-cyan-400',
    'text-indigo-600 dark:text-indigo-400',
    'text-rose-600 dark:text-rose-400',
  ];

  const getColor = (index: number) => colors[index % colors.length];

  return (
    <div className="flex flex-wrap gap-3 justify-center items-center py-4">
      {tags.map((tag, index) => (
        <Link
          key={tag.id}
          href={`/?tag_id=${tag.id}`}
          className={`
            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
            bg-gray-100 dark:bg-gray-800
            hover:bg-gray-200 dark:hover:bg-gray-700
            transition-all duration-200 hover:scale-105 hover:shadow-md
            ${getColor(index)}
          `}
          style={{ fontSize: `${getFontSize(tag.post_count || 1)}px` }}
          title={`${tag.post_count || 0} 篇文章`}
        >
          <TagIcon className="w-3.5 h-3.5 opacity-70" />
          <span className="font-medium">{tag.name}</span>
          {tag.post_count !== undefined && tag.post_count > 0 && (
            <span className="text-xs opacity-60">({tag.post_count})</span>
          )}
        </Link>
      ))}
    </div>
  );
}
