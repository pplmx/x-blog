'use client';

import { useState } from 'react';
import { useComments } from '@/lib/hooks';
import { Reply, User, MessageCircle } from 'lucide-react';

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

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  return (
    <div
      className={`${depth > 0 ? 'ml-6 pl-4 border-l-2 border-blue-100 dark:border-blue-900' : ''}`}
    >
      <div className="py-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {comment.nickname}
              </span>
              <span className="text-xs text-gray-400">{formatDate(comment.created_at)}</span>
            </div>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{comment.content}</p>
            <div className="mt-2">
              {canReply && (
                <button
                  onClick={() => onReply(comment.id, comment.nickname)}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                >
                  <Reply className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  回复
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-2">
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

import CommentForm from './CommentForm';

export default function CommentList({ postId }: { postId: number }) {
  const { data: comments, isLoading, error } = useComments(postId);
  const [replyTo, setReplyTo] = useState<{ id: number; nickname: string } | null>(null);

  // 将扁平评论转换为树形结构
  const buildCommentTree = (
    comments: CommentItemProps['comment'][]
  ): CommentItemProps['comment'][] => {
    const commentMap = new Map<number, CommentItemProps['comment']>();
    const roots: CommentItemProps['comment'][] = [];

    comments.forEach((comment) => {
      commentMap.set(comment.id, { ...comment, replies: [] });
    });

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
    document
      .getElementById('comment-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleCancelReply = () => {
    setReplyTo(null);
  };

  if (isLoading) {
    return (
      <div className="mt-8">
        <h2 className="text-2xl font-bold mb-4 dark:text-gray-100 flex items-center gap-2">
          <MessageCircle className="w-6 h-6" />
          评论加载中...
        </h2>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-2" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full mb-1" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-8 text-center py-8">
        <p className="text-red-500">加载评论失败，请稍后重试</p>
      </div>
    );
  }

  if (!comments) return null;

  const commentTree = buildCommentTree(comments);

  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold mb-6 dark:text-gray-100 flex items-center gap-2">
        <MessageCircle className="w-6 h-6" />
        评论 ({comments.length})
      </h2>
      {comments.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-2xl">
          <MessageCircle className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">暂无评论，快来抢沙发！</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {commentTree.map((comment) => (
            <CommentItem key={comment.id} comment={comment} postId={postId} onReply={handleReply} />
          ))}
        </div>
      )}

      {/* Comment Form */}
      <div id="comment-form">
        <CommentForm postId={postId} replyTo={replyTo} onCancelReply={handleCancelReply} />
      </div>
    </div>
  );
}
