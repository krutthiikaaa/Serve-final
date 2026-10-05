export const canteenSelect = {
  id: true,
  name: true,
  slug: true,
  location: true,
  openingHours: true,
  isActive: true,
  isAcceptingOrders: true,
} as const;

export type CanteenStatus = 'ACCEPTING_ORDERS' | 'PAUSED' | 'INACTIVE';

export interface CanteenRow {
  id: string;
  name: string;
  slug: string;
  location: string | null;
  openingHours: string | null;
  isActive: boolean;
  isAcceptingOrders: boolean;
}

export function canteenStatus(
  canteen: Pick<CanteenRow, 'isActive' | 'isAcceptingOrders'>,
): CanteenStatus {
  if (!canteen.isActive) return 'INACTIVE';
  return canteen.isAcceptingOrders ? 'ACCEPTING_ORDERS' : 'PAUSED';
}

/** True only when a student may place an order right now. */
export const canteenTakesOrders = (canteen: Pick<CanteenRow, 'isActive' | 'isAcceptingOrders'>) =>
  canteen.isActive && canteen.isAcceptingOrders;

export function toCanteenDto(canteen: CanteenRow) {
  return { ...canteen, status: canteenStatus(canteen) };
}

export function orderTakingPayload(canteen: CanteenRow) {
  return {
    canteenId: canteen.id,
    isActive: canteen.isActive,
    isAcceptingOrders: canteen.isAcceptingOrders,
    status: canteenStatus(canteen),
  };
}
