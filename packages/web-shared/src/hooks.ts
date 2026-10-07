import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (update: (current: T | undefined) => T | undefined) => void;
}

/**
 * Load REST data with loading/error state. `deps` re-trigger the fetch
 * (e.g. the realtime connection epoch, so data is refetched after reconnects).
 */
export function useResource<T>(fetcher: () => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (current === generation.current) {
        setDataState(result);
        setError(null);
      }
    } catch (err) {
      if (current === generation.current) setError(err);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback(
    (update: (current: T | undefined) => T | undefined) => setDataState(update),
    [],
  );
  return { data, error, loading, reload, setData };
}
