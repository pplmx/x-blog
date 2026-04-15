'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateComment } from '@/lib/hooks';
import { Send, X } from 'lucide-react';

interface CommentFormProps {
  postId: number;
  replyTo?: { id: number; nickname: string } | null;
  onCancelReply?: () => void;
}

export default function CommentForm({ postId, replyTo, onCancelReply }: CommentFormProps) {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const createComment = useCreateComment(postId, replyTo?.id);

  // Focus textarea when replying
  useEffect(() => {
    if (replyTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || !content.trim()) return;

    await createComment.mutateAsync({ nickname, email, content });

    setNickname('');
    setEmail('');
    setContent('');
    onCancelReply?.();
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="mt-8">
      {/* Reply indicator */}
      {replyTo && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center justify-between animate-in slide-in-from-top-2">
          <span className="text-sm text-blue-700 dark:text-blue-300">
            回复 <span className="font-semibold">@{replyTo.nickname}</span>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-400 p-1 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">
          {replyTo ? '发表回复' : '发表评论'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              昵称 <span className="text-red-500">*</span>
            </label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="你的昵称"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              邮箱 <span className="text-gray-400">(选填)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            评论内容 <span className="text-red-500">*</span>
          </label>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="说点什么..."
            className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
            rows={4}
            required
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={createComment.isPending || !nickname.trim() || !content.trim()}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40"
          >
            <Send className="w-4 h-4" />
            {createComment.isPending ? '提交中...' : replyTo ? '发表回复' : '发表评论'}
          </button>
        </div>
      </div>
    </form>
  );
}
