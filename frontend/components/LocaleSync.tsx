'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { localeFromPath, localizedPath, type Locale } from '@/lib/i18n';

const STORAGE_KEY = 'x-blog-locale';

function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'zh-CN') return stored;
  return 'zh-CN';
}

function storeLocale(locale: Locale) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, locale);
}

/** Persists locale preference when user navigates to a locale-prefixed path. */
export function LocaleSync() {
  const pathname = usePathname();

  useEffect(() => {
    const urlLocale = localeFromPath(pathname);
    const storedLocale = getStoredLocale();

    // Sync localStorage with URL when visiting locale-prefixed paths
    if (urlLocale !== defaultLocale && storedLocale !== urlLocale) {
      storeLocale(urlLocale);
    }
  }, [pathname]);

  return null;
}

// Re-export utilities for convenience
export { localeFromPath, localizedPath };
export type { Locale };
export type { defaultLocale };
