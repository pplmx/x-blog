'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { searchPosts } from '@/lib/api';
import { PostList, Category, Tag } from '@/types';

interface Suggestion {
  type: 'post' | 'category' | 'tag';
  item: PostList | Category | Tag;
}

export default function SearchBox() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShow(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await searchPosts(query, 1, 5);
        const posts = result.items.map((p) => ({ type: 'post' as const, item: p }));
        setSuggestions(posts.slice(0, 5));
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSearch = (q: string) => {
    setShow(false);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query.trim()) {
      handleSearch(query);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => query.trim() && setShow(true)}
        placeholder="搜索文章..."
        className="px-3 py-1.5 border rounded-md text-sm w-32 md:w-48 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:w-40 md:focus:w-48 transition-all"
      />

      {show && query.trim() && (
        <div className="absolute top-full mt-1 right-0 w-64 bg-white border rounded-md shadow-lg z-50">
          {loading ? (
            <div className="p-3 text-sm text-gray-500">加载中...</div>
          ) : suggestions.length > 0 ? (
            <ul>
              {suggestions.map((s, i) => (
                <li key={i}>
                  <button
                    onClick={() =>
                      handleSearch(
                        s.type === 'post'
                          ? (s.item as PostList).title
                          : (s.item as Category | Tag).name
                      )
                    }
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                  >
                    {s.type === 'post'
                      ? (s.item as PostList).title
                      : (s.item as Category | Tag).name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-3 text-sm text-gray-500">无结果</div>
          )}
        </div>
      )}
    </div>
  );
}
