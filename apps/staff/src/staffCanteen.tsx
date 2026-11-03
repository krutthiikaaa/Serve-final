import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MeStaff, StaffCapability } from '@serve/contracts';

const STORAGE_KEY = 'serve.staff.canteenId';

type Assignment = MeStaff['assignments'][number];

interface StaffCanteenValue {
  canteenId: string;
  assignment: Assignment | undefined;
  assignments: Assignment[];
  selectCanteen: (id: string) => void;
  hasCapability: (capability: StaffCapability) => boolean;
}

const StaffCanteenContext = createContext<StaffCanteenValue | null>(null);

function storedCanteenId() {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistCanteenId(id: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore quota / private mode */
  }
}

export function StaffCanteenProvider({ me, children }: { me: MeStaff; children: ReactNode }) {
  const assignments = me.assignments;
  const primaryId = me.canteen?.id ?? assignments[0]?.canteenId ?? '';
  const [canteenId, setCanteenId] = useState(() => {
    const stored = storedCanteenId();
    if (stored && assignments.some((row) => row.canteenId === stored)) return stored;
    return primaryId;
  });

  const value = useMemo<StaffCanteenValue>(() => {
    const resolved = assignments.some((row) => row.canteenId === canteenId) ? canteenId : primaryId;
    const assignment = assignments.find((row) => row.canteenId === resolved);
    return {
      canteenId: resolved,
      assignment,
      assignments,
      selectCanteen: (id: string) => {
        if (!assignments.some((row) => row.canteenId === id)) return;
        persistCanteenId(id);
        setCanteenId(id);
      },
      hasCapability: (capability) => assignment?.capabilities.includes(capability) ?? false,
    };
  }, [assignments, canteenId, primaryId]);

  return <StaffCanteenContext.Provider value={value}>{children}</StaffCanteenContext.Provider>;
}

export function useStaffCanteen() {
  const value = useContext(StaffCanteenContext);
  if (!value) throw new Error('useStaffCanteen must be used inside StaffCanteenProvider');
  return value;
}
