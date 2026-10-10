import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/**
 * Hook to automatically detect and follow the device / system theme.
 * Dynamically reacts when the device theme changes.
 */
export function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
      const isDark = e.matches;
      const newTheme: Theme = isDark ? 'dark' : 'light';
      setTheme(newTheme);

      // Apply to document element attributes and class for styling sync
      const root = document.documentElement;
      if (isDark) {
        root.classList.remove('light');
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
        root.style.colorScheme = 'dark';
      } else {
        root.classList.remove('dark');
        root.classList.add('light');
        root.setAttribute('data-theme', 'light');
        root.style.colorScheme = 'light';
      }

      // Update meta theme-color for mobile status bars
      const metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute('content', isDark ? '#0F172A' : '#FFFFFF');
      }
    };

    // Initial sync
    updateTheme(mediaQuery);

    // Dynamic listener
    try {
      mediaQuery.addEventListener('change', updateTheme);
      return () => mediaQuery.removeEventListener('change', updateTheme);
    } catch {
      // Fallback for older browsers
      mediaQuery.addListener(updateTheme);
      return () => mediaQuery.removeListener(updateTheme);
    }
  }, []);

  return theme;
}
