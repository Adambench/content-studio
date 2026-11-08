import { useSyncExternalStore } from 'react';
import { isApp } from '@/lib/native';

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');

/** The phone: the Android app, or a browser window as narrow as one. It has every page, laid out for a small screen. */
export const usePhone = () => useMediaQuery('(max-width: 767px)') || isApp;
