'use client';

import { useState } from 'react';
import { useComments, useCreateComment } from '@/lib/hooks';
import { Reply, User } from 'lucide-react';

interface CommentItemProps {
  comment: {
    id: number;
    nickname: string;
    content: string;
    created_at: string;
    parent_id?: number | null;
    replies?: CommentItemProps['comment'][];
  };
  postId: number;
  onReply: (commentId: number, nickname: string) => void;
  depth?: number;
}

function CommentItem({ comment, postId, onReply, depth = 0 }: CommentItemProps) {
  const maxDepth = 3;
  const canReply = depth < maxDepth;

  return (
    <div
      className={`${depth > 0 ? 'ml-8 pl-4 border-l-2 border-gray-100 dark:border-gray-700' : ''}`}
    >
      <div className="py-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
          <span className="font-medium text-gray-900 dark:text-gray-100">{comment.nickname}</span>
          <span className="text-sm text-gray-400">
            {new Date(comment.created_at).toLocaleDateString('zh-CN')}
          </span>
        </div>
        <p className="text-gray-700 dark:text-gray-300 ml-10">{comment.content}</p>
        <div className="ml-10 mt-2">
          {canReply && (
            <button
              onClick={() => onReply(comment.id, comment.nickname)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              <Reply className="w-4 h-4" />
              回复
            </button>
          )}
        </div>
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div>
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              postId={postId}
              onReply={onReply}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommentList({ postId }: { postId: number }) {
  const { data: comments, isLoading, error } = useComments(postId);
  const [replyTo, setReplyTo] = useState<{ id: number; nickname: string } | null>(null);

  // 将扁平评论转换为树形结构
  const buildCommentTree = (
    comments: CommentItemProps['comment'][]
  ): CommentItemProps['comment'][] => {
    const commentMap = new Map<number, CommentItemProps['comment']>();
    const roots: CommentItemProps['comment'][] = [];

    // 先建立映射
    comments.forEach((comment) => {
      commentMap.set(comment.id, { ...comment, replies: [] });
    });

    // 构建树
    comments.forEach((comment) => {
      const node = commentMap.get(comment.id);
      if (!node) return;

      if (comment.parent_id && commentMap.has(comment.parent_id)) {
        const parent = commentMap.get(comment.parent_id);
        if (parent?.replies) {
          parent.replies.push(node);
        }
      } else {
        roots.push(node);
      }
    });

    return roots;
  };

  const handleReply = (commentId: number, nickname: string) => {
    setReplyTo({ id: commentId, nickname });
    // 滚动到评论框
    document.getElementById('comment-form')?.scrollIntoView({ behavior: 'smooth' });
  };

  if (isLoading) return <div className="text-gray-500">加载中...</div>;
  if (error) return <div className="text-red-500">加载评论失败</div>;
  if (!comments) return null;

  const commentTree = buildCommentTree(comments);

  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold mb-4 dark:text-gray-100">评论 ({comments.length})</h2>
      {comments.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">暂无评论，快来抢沙发！</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {commentTree.map((comment) => (
            <CommentItem key={comment.id} comment={comment} postId={postId} onReply={handleReply} />
          ))}
        </div>
      )}

      {/* 传递 replyTo 到评论表单 */}
      <div id="comment-form">
        {replyTo && (
          <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-300">
              回复 <span className="font-medium">@{replyTo.nickname}</span>
            </span>
            <button
              onClick={() => setReplyTo(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// 导出用于 CommentForm 访问
export { useState } from 'react';
