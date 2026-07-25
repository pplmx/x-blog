'use client';

import { useState } from 'react';
import { Share2, Link2, Check } from 'lucide-react';

interface ShareButtonsProps {
  title: string;
  url?: string;
}

const weiboIcon = `<svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M10.098 20.323c-3.977.391-7.414-1.406-7.672-4.02-.259-2.609 2.759-5.047 6.74-5.441 3.979-.394 7.413 1.404 7.671 4.018.259 2.6-2.759 5.049-6.739 5.443zM9.05 17.219c-.384.616-1.208.884-1.829.602-.612-.279-.793-.991-.406-1.593.379-.595 1.176-.861 1.793-.601.622.263.82.972.442 1.592zm1.27-1.627c-.141.237-.449.353-.689.253-.236-.09-.313-.361-.177-.586.138-.227.436-.346.672-.24.239.09.315.36.194.573zm.176-2.719c-1.893-.493-4.033.45-4.857 2.118-.836 1.704-.026 3.591 1.886 4.21 1.983.64 4.318-.341 5.132-2.179.8-1.793-.201-3.642-2.161-4.149zm7.563-1.224c-.346-.105-.578-.172-.399-.623.389-.985.428-1.833.003-2.441-.801-1.145-3.22-.932-5.822-.206-3.107.868-5.001 2.127-5.32 3.396-.318 1.265.453 2.22 1.991 2.878 1.833.784 4.237.58 5.641-.359 1.053-.703 1.2-1.536.788-2.229-.371-.625-1.27-.973-2.314-1.033-.853-.049-1.564.057-1.615.195-.051.138.33.418 1.103.676-.857.435-1.134.907-1.014 1.438.177.78 1.281 1.239 3.062 1.326 2.196.108 3.961-.624 4.351-1.73.391-1.106-.266-1.684-1.455-2.288z"/></svg>`;

export default function ShareButtons({ title, url }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const currentUrl = url || (typeof window !== 'undefined' ? window.location.href : '');
  const encodedUrl = encodeURIComponent(currentUrl);
  const encodedTitle = encodeURIComponent(title);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const shareToWeibo = () => {
    window.open(
      `https://service.weibo.com/share/share.php?url=${encodedUrl}&title=${encodedTitle}`,
      '_blank',
      'width=550,height=450'
    );
  };

  return (
    <div className="flex items-center justify-center gap-4 py-6 my-8 border-y border-gray-200 dark:border-gray-700">
      <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Share2 className="w-4 h-4" />
        分享到
      </span>

      {/* 微博 */}
      <button
        onClick={shareToWeibo}
        className="p-2 rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
        title="分享到微博"
      >
        <span dangerouslySetInnerHTML={{ __html: weiboIcon }} />
      </button>

      {/* 复制链接 */}
      <button
        onClick={handleCopyLink}
        className="p-2 rounded-full bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        title="复制链接"
      >
        {copied ? <Check className="w-5 h-5 text-green-600" /> : <Link2 className="w-5 h-5" />}
      </button>
    </div>
  );
}
