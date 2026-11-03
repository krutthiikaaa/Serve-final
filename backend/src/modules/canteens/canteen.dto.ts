import type { Clock } from '../../lib/time.js';
import { systemClock } from '../../lib/time.js';
import {
  evaluateServiceAvailability,
  type ConfigurationWarning,
  type ServicePeriod,
} from './availability.js';

export const canteenScheduleSelect = {
  weekday: true,
  opensAtMinutes: true,
  closesAtMinutes: true,
} as const;

export const canteenServiceSelect = {
  period: true,
  isEnabled: true,
  override: true,
  schedules: { select: canteenScheduleSelect, orderBy: { weekday: 'asc' as const } },
} as const;

export const canteenSelect = {
  id: true,
  name: true,
  slug: true,
  location: true,
  openingHours: true,
  isActive: true,
  isAcceptingOrders: true,
  services: { select: canteenServiceSelect, orderBy: { period: 'asc' as const } },
} as const;

export type CanteenStatus = 'ACCEPTING_ORDERS' | 'PAUSED' | 'INACTIVE';

export interface CanteenServiceRow {
  period: ServicePeriod;
  isEnabled: boolean;
  override: 'AUTO' | 'FORCE_OPEN' | 'FORCE_CLOSED';
  schedules: { weekday: number; opensAtMinutes: number; closesAtMinutes: number }[];
}

export interface CanteenRow {
  id: string;
  name: string;
  slug: string;
  location: string | null;
  openingHours: string | null;
  isActive: boolean;
  isAcceptingOrders: boolean;
  services: CanteenServiceRow[];
}

export function canteenStatus(
  canteen: Pick<CanteenRow, 'isActive' | 'isAcceptingOrders'>,
): CanteenStatus {
  if (!canteen.isActive) return 'INACTIVE';
  return canteen.isAcceptingOrders ? 'ACCEPTING_ORDERS' : 'PAUSED';
}

/** True only when a student may place an order right now (canteen-level pause). */
export const canteenTakesOrders = (canteen: Pick<CanteenRow, 'isActive' | 'isAcceptingOrders'>) =>
  canteen.isActive && canteen.isAcceptingOrders;

export function serviceAvailability(
  canteen: Pick<CanteenRow, 'isActive' | 'isAcceptingOrders'>,
  service: CanteenServiceRow | null | undefined,
  now?: Date,
) {
  return evaluateServiceAvailability({
    canteen,
    service: service ?? null,
    schedules: service?.schedules ?? [],
    now,
  });
}

export function toCanteenDto(canteen: CanteenRow) {
  return {
    id: canteen.id,
    name: canteen.name,
    slug: canteen.slug,
    location: canteen.location,
    openingHours: canteen.openingHours,
    isActive: canteen.isActive,
    isAcceptingOrders: canteen.isAcceptingOrders,
    status: canteenStatus(canteen),
  };
}

export function toPublicCanteenDto(canteen: CanteenRow, now: Date = systemClock()) {
  const configurationWarnings: { period: ServicePeriod; code: ConfigurationWarning }[] = [];
  const services = (canteen.services ?? []).map((service) => {
    const availability = serviceAvailability(canteen, service, now);
    for (const code of availability.warnings) {
      configurationWarnings.push({ period: service.period, code });
    }
    return {
      period: service.period,
      isEnabled: service.isEnabled,
      override: service.override,
      isOpenNow: availability.open,
    };
  });
  return {
    ...toCanteenDto(canteen),
    supportedPeriods: services.map((service) => service.period),
    services,
    configurationWarnings,
  };
}

export function orderTakingPayload(canteen: CanteenRow) {
  return {
    canteenId: canteen.id,
    isActive: canteen.isActive,
    isAcceptingOrders: canteen.isAcceptingOrders,
    status: canteenStatus(canteen),
  };
}

export function resolveNow(clock?: Clock, now?: Date) {
  return now ?? (clock ?? systemClock)();
}
