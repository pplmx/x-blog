import { describe, it, expect } from 'vitest';

describe('ThemeProvider', () => {
  it('exports holiday themes', () => {
    const holidayThemes = [
      { name: 'christmas', accent: '#ef4444', label: '🎄 Christmas' },
      { name: 'halloween', accent: '#f97316', label: '🎃 Halloween' },
      { name: 'newyear', accent: '#22c55e', label: '🎆 New Year' },
    ];

    expect(holidayThemes).toHaveLength(3);
    expect(holidayThemes[0].name).toBe('christmas');
    expect(holidayThemes[1].name).toBe('halloween');
    expect(holidayThemes[2].name).toBe('newyear');
  });
});
