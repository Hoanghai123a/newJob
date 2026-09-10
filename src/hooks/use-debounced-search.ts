import { useEffect, useState } from "react";

export const DEFAULT_SEARCH_DEBOUNCE_MS = 500;

/**
 * Tra ve tu khoa tim kiem da tri hoan.
 * - Gia tri rong duoc ap dung ngay de thao tac xoa tim kiem khong bi cham.
 * - Moi lan nguoi dung go tiep, bo dem cu bi huy va dem lai tu dau.
 */
export function useDebouncedSearch(value: string, delayMs: number = DEFAULT_SEARCH_DEBOUNCE_MS) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (value === debounced) return;
    if (!value.trim()) {
      setDebounced(value);
      return;
    }

    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, debounced, delayMs]);

  return debounced;
}
