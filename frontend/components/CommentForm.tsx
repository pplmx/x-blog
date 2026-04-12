'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateComment } from '@/lib/hooks';

export default function CommentForm({ postId }: { postId: number }) {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [content, setContent] = useState('');

  const createComment = useCreateComment(postId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || !content.trim()) return;

    await createComment.mutateAsync({ nickname, email, content });

    setNickname('');
    setEmail('');
    setContent('');
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="mt-8 border p-4 rounded">
      <h3 className="text-xl font-bold mb-4">发表评论</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-sm mb-1">昵称 *</label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full border rounded px-3 py-2"
            required
          />
        </div>
        <div>
          <label className="block text-sm mb-1">邮箱</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">评论内容 *</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full border rounded px-3 py-2 h-24"
            required
          />
        </div>
        <button
          type="submit"
          disabled={createComment.isPending}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {createComment.isPending ? '提交中...' : '提交评论'}
        </button>
      </div>
    </form>
  );
}
