'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  createTranslator,
  defaultLocale,
  localeFromPath,
  localizedPath,
  type Locale,
  type TranslationKey,
} from './i18n';

const STORAGE_KEY = 'x-blog-locale';

function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return defaultLocale;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'zh-CN') return stored;
  return defaultLocale;
}

function storeLocale(locale: Locale) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, locale);
}

/** Client-side hook for translations.
 *
 * Uses URL-based locale detection with localStorage fallback.
 */
export function useTranslations(): {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  locale: Locale;
  switchLocale: (locale: Locale) => void;
} {
  const pathname = usePathname();
  const router = useRouter();

  const locale: Locale = getStoredLocale();
  const t = createTranslator(locale);

  const switchLocale = useCallback(
    (newLocale: Locale) => {
      storeLocale(newLocale);
      const newPath = localizedPath(pathname, newLocale);
      router.push(newPath);
    },
    [pathname, router]
  );

  return { t, locale, switchLocale };
}

/** Detect locale from the current URL pathname (for server components). */
export function detectLocaleFromPathname(pathname: string): Locale {
  return localeFromPath(pathname);
}
