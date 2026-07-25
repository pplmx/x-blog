'use client';

import { useState, useEffect } from 'react';
import { Heart } from 'lucide-react';
import { incrementLikes } from '@/lib/api';

interface LikeButtonProps {
  postId: number;
  initialLikes: number;
}

export default function LikeButton({ postId, initialLikes }: LikeButtonProps) {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load liked state from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(`liked_${postId}`);
      if (stored === 'true') {
        setLiked(true);
      }
    }
  }, [postId]);

  const handleLike = async () => {
    if (liked || loading) return;

    setLoading(true);
    try {
      const updated = await incrementLikes(postId);
      setLikes(updated.likes);
      setLiked(true);
      // Persist to localStorage
      localStorage.setItem(`liked_${postId}`, 'true');
    } catch (error) {
      console.error('Failed to like post:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleLike}
      disabled={liked || loading}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
        liked
          ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400'
      }`}
    >
      <Heart className={`w-4 h-4 transition-all duration-200 ${liked ? 'fill-current' : ''}`} />
      <span>{likes}</span>
    </button>
  );
}
