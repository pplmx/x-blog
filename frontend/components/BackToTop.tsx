'use client';

import { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';

export default function BackToTop() {
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      // Show button when scrolled down 300px
      setIsVisible(window.scrollY > 300);
    };

    window.addEventListener('scroll', toggleVisibility, { passive: true });
    return () => window.removeEventListener('scroll', toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  if (!isVisible) {
    return null;
  }

  return (
    <button
      onClick={scrollToTop}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        fixed bottom-6 right-6 z-50
        p-3 rounded-full
        bg-white dark:bg-gray-800
        border border-gray-200 dark:border-gray-700
        shadow-lg hover:shadow-xl
        transition-all duration-300 ease-out
        ${isHovered ? 'scale-110' : 'scale-100'}
        hover:border-blue-300 dark:hover:border-blue-600
        hover:text-blue-600 dark:hover:text-blue-400
        text-gray-500 dark:text-gray-400
      `}
      title="返回顶部"
    >
      <ArrowUp className={`w-5 h-5 transition-transform ${isHovered ? '-translate-y-0.5' : ''}`} />
    </button>
  );
}
