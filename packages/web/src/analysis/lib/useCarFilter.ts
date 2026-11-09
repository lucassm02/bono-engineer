/** Car filter state shared by the history screens; the last choice is remembered (localStorage). */

import { useCallback, useState } from 'react';
import { type CarFilter, loadCarFilter, saveCarFilter } from './carFilter.ts';

export function useCarFilter(initial?: CarFilter): [CarFilter, (f: CarFilter) => void] {
  const [filter, setFilter] = useState<CarFilter>(() => initial ?? loadCarFilter());
  const update = useCallback((f: CarFilter) => {
    setFilter(f);
    saveCarFilter(f);
  }, []);
  return [filter, update];
}
