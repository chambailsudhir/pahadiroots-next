'use client';
// useDebounce — delays a value update until the user stops typing.
// Usage: const debouncedSearch = useDebounce(search, 300);
// Then use debouncedSearch for filtering / API calls instead of raw search.
//
// BUILD FIX: this file was present in pahadi-admin-main but missing from
// pahadiroots-next, causing "Cannot find module '@/hooks/useDebounce'" at
// tsc / next build time.

import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
