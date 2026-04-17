'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export function useData(fetcher, deps = []) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
}

// Convenience: fetch single table
export function useTable(table, query, deps = []) {
  return useData(() => api.get(table, query), [table, query, ...deps]);
}
