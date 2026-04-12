'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

// Holiday themes
export const holidayThemes = [
  { name: 'christmas', accent: '#ef4444', label: '🎄 Christmas' },
  { name: 'halloween', accent: '#f97316', label: '🎃 Halloween' },
  { name: 'newyear', accent: '#22c55e', label: '🎆 New Year' },
];
