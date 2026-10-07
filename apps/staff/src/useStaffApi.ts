import { createContext, useContext } from 'react';
import type { StaffApi } from './api/staff';

export const StaffApiContext = createContext<StaffApi | null>(null);

export function useStaffApi(): StaffApi {
  const api = useContext(StaffApiContext);
  if (!api) throw new Error('useStaffApi must be used inside StaffApiContext');
  return api;
}
