import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { MeStaff, StaffCapability } from '@serve/contracts';

type Assignment = MeStaff['assignments'][number];

/**
 * The staff member's canteen. Every staff account is dedicated to exactly one
 * canteen (decided by the backend from PostgreSQL); there is no canteen
 * switching in the dashboard.
 */
interface StaffCanteenValue {
  canteenId: string;
  /** DAY or NIGHT: the canteen's own (and only) service period. */
  canteenType: 'DAY' | 'NIGHT';
  assignment: Assignment | undefined;
  hasCapability: (capability: StaffCapability) => boolean;
}

const StaffCanteenContext = createContext<StaffCanteenValue | null>(null);

export function StaffCanteenProvider({ me, children }: { me: MeStaff; children: ReactNode }) {
  const value = useMemo<StaffCanteenValue>(() => {
    const canteenId = me.canteen?.id ?? '';
    const assignment = me.assignments.find((row) => row.canteenId === canteenId);
    return {
      canteenId,
      canteenType: me.canteen?.type ?? 'NIGHT',
      assignment,
      hasCapability: (capability) => assignment?.capabilities.includes(capability) ?? false,
    };
  }, [me]);

  return <StaffCanteenContext.Provider value={value}>{children}</StaffCanteenContext.Provider>;
}

export function useStaffCanteen() {
  const value = useContext(StaffCanteenContext);
  if (!value) throw new Error('useStaffCanteen must be used inside StaffCanteenProvider');
  return value;
}
