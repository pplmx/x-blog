'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { localeFromPath, localizedPath, locales, localeNames, type Locale } from '@/lib/i18n';

/** Language switcher dropdown component. */
export default function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const currentLocale = localeFromPath(pathname);

  const handleSwitch = useCallback(
    (newLocale: Locale) => {
      const newPath = localizedPath(pathname, newLocale);
      localStorage.setItem('x-blog-locale', newLocale);
      router.push(newPath);
    },
    [pathname, router]
  );

  return (
    <div className="relative inline-block">
      <select
        value={currentLocale}
        onChange={(e) => handleSwitch(e.target.value as Locale)}
        className="appearance-none bg-transparent border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 pr-6 text-sm text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        aria-label="Switch language"
      >
        {locales.map((locale) => (
          <option key={locale} value={locale}>
            {localeNames[locale]}
          </option>
        ))}
      </select>
      <svg
        className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
