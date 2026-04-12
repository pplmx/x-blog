'use client';

import { useEffect, useRef } from 'react';
import { incrementViews } from '@/lib/api';

interface ViewTrackerProps {
  postId: number;
}

export default function ViewTracker({ postId }: ViewTrackerProps) {
  const hasTracked = useRef(false);

  useEffect(() => {
    if (hasTracked.current) return;
    hasTracked.current = true;

    // Increment view count on client side
    incrementViews(postId).catch(console.error);
  }, [postId]);

  return null;
}