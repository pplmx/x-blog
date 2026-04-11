'use client';

import { useComments } from '@/lib/hooks';

export default function CommentList({ postId }: { postId: number }) {
  const { data: comments, isLoading, error } = useComments(postId);

  if (isLoading) return <div>加载中...</div>;
  if (error) return <div>加载评论失败</div>;
  if (!comments) return null;

  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold mb-4">评论 ({comments.length})</h2>
      {comments.length === 0 ? (
        <p className="text-gray-500">暂无评论，快来抢沙发！</p>
      ) : (
        <div className="space-y-4">
          {comments.map((comment) => (
            <div key={comment.id} className="border-b pb-4">
              <div className="font-semibold">{comment.author}</div>
              <p className="text-gray-700 mt-1">{comment.content}</p>
              <div className="text-sm text-gray-400 mt-2">
                {new Date(comment.created_at).toLocaleString('zh-CN')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
