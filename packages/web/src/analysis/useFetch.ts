/** Minimal data-fetching hook (no dependency): loads on key change, keeps the last data on reload. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.ts';

export interface FetchState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  /** Replaces the cached data (optimistic updates after a mutation). */
  setData: (d: T | null) => void;
}

/**
 * `key` null = do not load. The loader runs again when `key` changes or `reload()` is called;
 * results of stale requests are dropped. `pollMs` reloads periodically (silently).
 */
export function useFetch<T>(
  key: string | null,
  loader: (signal: AbortSignal) => Promise<T>,
  pollMs?: number,
): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const lastKey = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick triggers reloads on purpose
  useEffect(() => {
    if (key === null) {
      setLoading(false);
      return;
    }
    if (lastKey.current !== key) {
      setData(null);
      lastKey.current = key;
    }
    const ac = new AbortController();
    setLoading(true);
    loaderRef
      .current(ac.signal)
      .then((d) => {
        if (ac.signal.aborted) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || (e as Error).name === 'AbortError') return;
        setError(
          e instanceof ApiError ? e : new ApiError((e as Error).message || String(e), 0, 'client'),
        );
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [key, tick]);

  useEffect(() => {
    if (!pollMs || key === null) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    }, pollMs);
    return () => clearInterval(t);
  }, [pollMs, key]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}
