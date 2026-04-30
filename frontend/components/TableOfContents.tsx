'use client';

import { useEffect, useState } from 'react';
import { TocItem } from './Markdown';
import { List } from 'lucide-react';

interface TableOfContentsProps {
  toc: TocItem[];
}

export default function TableOfContents({ toc }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: '-80px 0px -80% 0px' }
    );

    toc.forEach((item) => {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [toc]);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const element = document.getElementById(id);
    if (element) {
      const top = element.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: 'smooth' });
      setActiveId(id);
    }
  };

  if (toc.length === 0) {
    return null;
  }

  return (
    <nav className="sticky top-24">
      <div className="flex items-center gap-2 mb-4">
        <List className="w-4 h-4 text-gray-400" />
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">目录</h4>
      </div>
      <div className="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
        <ul className="space-y-1.5 text-sm">
          {toc.map((item) => (
            <li key={item.id} style={{ paddingLeft: `${(item.level - 1) * 12}px` }}>
              <a
                href={`#${item.id}`}
                onClick={(e) => handleClick(e, item.id)}
                className={`block py-1.5 px-3 rounded-lg transition-all duration-200 ${
                  activeId === item.id
                    ? 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 border-l-2 border-blue-500 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}