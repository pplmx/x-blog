'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, MessageCircle, Calendar, User, Globe } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdminComments, deleteAdminComment, AdminComment } from '@/lib/api';
import Link from 'next/link';

export default function CommentsPage() {
  const queryClient = useQueryClient();
  const [filterPostId, setFilterPostId] = useState<number | undefined>(undefined);

  const { data: comments, isLoading, error } = useQuery({
    queryKey: ['admin-comments', filterPostId],
    queryFn: () => fetchAdminComments(filterPostId),
  });

  const deleteComment = useMutation({
    mutationFn: deleteAdminComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-comments'] });
    },
  });

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条评论吗？')) return;
    await deleteComment.mutateAsync(id);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-500">
        加载失败: {String(error)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">评论管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            共 {comments?.length || 0} 条评论
          </p>
        </div>
      </div>

      {comments?.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-card rounded-xl border p-8">
          <MessageCircle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium">暂无评论</p>
          <p className="text-sm mt-1">等待读者留下评论</p>
        </div>
      ) : (
        <div className="space-y-4">
          {comments?.map((comment) => (
            <div
              key={comment.id}
              className="bg-card border rounded-xl p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* 评论者信息 */}
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex items-center gap-1.5 text-sm">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="font-medium">{comment.nickname}</span>
                    </div>
                    {comment.email && (
                      <span className="text-xs text-muted-foreground">
                        {comment.email}
                      </span>
                    )}
                  </div>
                  
                  {/* 所属文章 */}
                  <div className="mb-2">
                    <Link
                      href={`/admin/posts/${comment.post_id}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      文章: {comment.post_title}
                    </Link>
                  </div>
                  
                  {/* 评论内容 */}
                  <div className="bg-muted/50 rounded-lg p-3 mb-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">
                      {comment.content}
                    </p>
                  </div>
                  
                  {/* 元信息 */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(comment.created_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Globe className="w-3.5 h-3.5" />
                      {comment.ip_address}
                    </span>
                  </div>
                </div>
                
                {/* 操作按钮 */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(comment.id)}
                  disabled={deleteComment.isPending}
                  className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}