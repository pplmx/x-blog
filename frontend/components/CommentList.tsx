"use client";

import { useEffect, useState } from "react";

interface Comment {
  id: number;
  nickname: string;
  content: string;
  created_at: string;
}

export default function CommentList({ postId }: { postId: number }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/comments/post/${postId}`)
      .then((res) => res.json())
      .then((data) => {
        setComments(data);
        setLoading(false);
      });
  }, [postId]);

  if (loading) return <div>加载中...</div>;

  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold mb-4">评论 ({comments.length})</h2>
      {comments.length === 0 ? (
        <p className="text-gray-500">暂无评论，快来抢沙发！</p>
      ) : (
        <div className="space-y-4">
          {comments.map((comment) => (
            <div key={comment.id} className="border-b pb-4">
              <div className="font-semibold">{comment.nickname}</div>
              <p className="text-gray-700 mt-1">{comment.content}</p>
              <div className="text-sm text-gray-400 mt-2">
                {new Date(comment.created_at).toLocaleString("zh-CN")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}