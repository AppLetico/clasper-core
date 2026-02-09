import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

/**
 * Lightweight data-fetching hook.
 * Returns { data, loading, error, reload }.
 * Automatically refetches when `deps` change.
 */
export function useApi(fetchFn, deps = []) {
  const data = useRef(signal(null)).current;
  const loading = useRef(signal(true)).current;
  const error = useRef(signal(null)).current;

  const load = async () => {
    loading.value = true;
    error.value = null;
    try {
      data.value = await fetchFn();
    } catch (e) {
      error.value = e;
      data.value = null;
    } finally {
      loading.value = false;
    }
  };

  useEffect(() => { load(); }, deps);

  return { data, loading, error, reload: load };
}
