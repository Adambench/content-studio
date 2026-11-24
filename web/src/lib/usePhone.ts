import { useSyncExternalStore } from 'react';
import { isNative } from './native';

const query = '(max-width: 767px)';
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(query);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};

/** The phone layout: the Android shell, or a narrow window. */
export function usePhone(): boolean {
  const narrow = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
  return isNative || narrow;
}
