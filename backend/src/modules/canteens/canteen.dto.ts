import type { Clock } from '../../lib/time.js';
import { istParts, systemClock } from '../../lib/time.js';
import {
  effectiveTarget,
  minutesToClock,
  nextScheduledTransition,
  type AreaScheduleFields,
} from './area-schedule.js';
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
  type: true,
  serviceAreaId: true,
  location: true,
  openingHours: true,
  isActive: true,
  isAcceptingOrders: true,
  isPaused: true,
  services: { select: canteenServiceSelect, orderBy: { period: 'asc' as const } },
  serviceArea: {
    select: {
      id: true,
      name: true,
      autoSwitchEnabled: true,
      timezone: true,
      dayOpensAtMinutes: true,
      dayClosesAtMinutes: true,
      nightOpensAtMinutes: true,
      nightClosesAtMinutes: true,
      overrideTarget: true,
      overrideUntil: true,
      overrideSetAt: true,
      canteens: {
        select: {
          id: true,
          name: true,
          type: true,
          isActive: true,
          isAcceptingOrders: true,
          isPaused: true,
        },
        orderBy: { type: 'asc' as const },
      },
    },
  },
} as const;

export type CanteenStatus = 'ACCEPTING_ORDERS' | 'PAUSED' | 'INACTIVE';

export interface CanteenServiceRow {
  period: ServicePeriod;
  isEnabled: boolean;
  override: 'AUTO' | 'FORCE_OPEN' | 'FORCE_CLOSED';
  schedules: { weekday: number; opensAtMinutes: number; closesAtMinutes: number }[];
}

export interface SiblingRow {
  id: string;
  name: string;
  type: ServicePeriod;
  isActive: boolean;
  isAcceptingOrders: boolean;
  isPaused: boolean;
}

export interface CanteenRow {
  id: string;
  name: string;
  slug: string;
  type: ServicePeriod;
  serviceAreaId: string;
  location: string | null;
  openingHours: string | null;
  isActive: boolean;
  isAcceptingOrders: boolean;
  isPaused: boolean;
  services: CanteenServiceRow[];
  serviceArea: { id: string; name: string; canteens: SiblingRow[] } & AreaScheduleFields;
}

/**
 * Availability of one canteen, the same for students, staff and admins.
 *   INACTIVE              disabled by an admin ("Temporarily disabled")
 *   OTHER_SERVICE_ACTIVE  off duty: the area's other canteen is serving
 *   CLOSED_BY_SCHEDULE    off duty: the area's schedule has no service for it now
 *   OFF_DUTY              off duty: no canteen of the area is serving
 *   PAUSED                on duty, but its staff/admin paused new orders
 *   SERVICE_DISABLED      the canteen's service is switched off
 *   CLOSED                outside the canteen's own opening hours
 *   OPEN                  taking orders now
 */
export type AvailabilityState =
  | 'OPEN'
  | 'CLOSED'
  | 'PAUSED'
  | 'OFF_DUTY'
  | 'CLOSED_BY_SCHEDULE'
  | 'OTHER_SERVICE_ACTIVE'
  | 'SERVICE_DISABLED'
  | 'INACTIVE';

export function ownService(canteen: Pick<CanteenRow, 'type' | 'services'>) {
  return (canteen.services ?? []).find((service) => service.period === canteen.type) ?? null;
}

export function canteenAvailability(canteen: CanteenRow, now: Date = systemClock()) {
  const service = ownService(canteen);
  const result = serviceAvailability(canteen, service, now);
  const otherOpen =
    canteen.serviceArea?.canteens.find(
      (row) => row.id !== canteen.id && row.isActive && row.isAcceptingOrders,
    ) ?? null;
  const { weekday } = istParts(now);
  const today = service?.schedules.find((row) => row.weekday === weekday) ?? null;

  let state: AvailabilityState;
  let message: string;
  if (!canteen.isActive) {
    state = 'INACTIVE';
    message = 'This canteen is currently unavailable.';
  } else if (!canteen.isAcceptingOrders && otherOpen) {
    state = 'OTHER_SERVICE_ACTIVE';
    message = `${otherOpen.name} is serving this area right now.`;
  } else if (!canteen.isAcceptingOrders) {
    const area = canteen.serviceArea;
    const { mode } = effectiveTarget(area, now);
    if (mode === 'AUTOMATIC') {
      state = 'CLOSED_BY_SCHEDULE';
      const opens = nextOpeningOf(area, canteen.type, now);
      message = opens ? `Closed by schedule. Opens at ${opens}.` : 'Closed by schedule.';
    } else {
      state = 'OFF_DUTY';
      message = 'Not serving right now.';
    }
  } else if (canteen.isPaused) {
    state = 'PAUSED';
    message = 'Ordering is paused for now.';
  } else if (result.open) {
    state = 'OPEN';
    message = 'Taking orders now.';
  } else if (result.code === 'SERVICE_DISABLED') {
    state = 'SERVICE_DISABLED';
    message = 'This service is not available.';
  } else {
    state = 'CLOSED';
    message = 'Closed at the moment.';
  }
  return {
    state,
    isOpenNow: result.open,
    message,
    override: service?.override ?? null,
    today: today
      ? { opensAtMinutes: today.opensAtMinutes, closesAtMinutes: today.closesAtMinutes }
      : null,
    otherServiceCanteen: otherOpen
      ? { id: otherOpen.id, name: otherOpen.name, type: otherOpen.type }
      : null,
  };
}

/** Local opening time ("HH:MM") of the next scheduled window for `type`. */
function nextOpeningOf(area: AreaScheduleFields, type: ServicePeriod, now: Date): string | null {
  let at = now;
  for (let i = 0; i < 4; i += 1) {
    const next = nextScheduledTransition(area, at);
    if (!next) return null;
    if (next.target === type) {
      const opens = type === 'DAY' ? area.dayOpensAtMinutes : area.nightOpensAtMinutes;
      return opens === null ? null : minutesToClock(opens);
    }
    at = next.at;
  }
  return null;
}

export function canteenStatus(
  canteen: Pick<CanteenRow, 'isActive' | 'isAcceptingOrders' | 'isPaused'>,
): CanteenStatus {
  if (!canteen.isActive) return 'INACTIVE';
  return canteen.isAcceptingOrders && !canteen.isPaused ? 'ACCEPTING_ORDERS' : 'PAUSED';
}

/** True only when the canteen is active, on duty and not paused. */
export const canteenTakesOrders = (
  canteen: Pick<CanteenRow, 'isActive' | 'isAcceptingOrders' | 'isPaused'>,
) => canteen.isActive && canteen.isAcceptingOrders && !canteen.isPaused;

export function serviceAvailability(
  canteen: Pick<CanteenRow, 'isActive' | 'isAcceptingOrders' | 'isPaused'>,
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

export function toCanteenDto(canteen: CanteenRow, now: Date = systemClock()) {
  return {
    id: canteen.id,
    name: canteen.name,
    slug: canteen.slug,
    type: canteen.type,
    serviceArea: { id: canteen.serviceArea.id, name: canteen.serviceArea.name },
    location: canteen.location,
    openingHours: canteen.openingHours,
    isActive: canteen.isActive,
    /** On duty for its service area (set by the schedule or an admin). */
    isAcceptingOrders: canteen.isAcceptingOrders,
    /** Temporarily paused by staff/admin. Never changed by the schedule. */
    isPaused: canteen.isPaused,
    status: canteenStatus(canteen),
    availability: canteenAvailability(canteen, now),
  };
}

export function toPublicCanteenDto(canteen: CanteenRow, now: Date = systemClock()) {
  const configurationWarnings: { period: ServicePeriod; code: ConfigurationWarning }[] = [];
  const services = (canteen.services ?? [])
    .filter((service) => service.period === canteen.type)
    .map((service) => {
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
    ...toCanteenDto(canteen, now),
    supportedPeriods: services.map((service) => service.period),
    services,
    configurationWarnings,
  };
}

export function orderTakingPayload(canteen: CanteenRow) {
  return {
    canteenId: canteen.id,
    serviceAreaId: canteen.serviceAreaId,
    type: canteen.type,
    isActive: canteen.isActive,
    isAcceptingOrders: canteen.isAcceptingOrders,
    isPaused: canteen.isPaused,
    status: canteenStatus(canteen),
    availability: canteenAvailability(canteen),
  };
}

export function resolveNow(clock?: Clock, now?: Date) {
  return now ?? (clock ?? systemClock)();
}
