import { ConflictError } from '../../lib/errors.js';
import { systemClock, type Clock } from '../../lib/time.js';
import {
  inspectOperatingSchedules,
  isWithinOperatingWindow,
  type OperatingScheduleRow,
} from './schedule.js';

export type ServicePeriod = 'DAY' | 'NIGHT';
export type ScheduleOverride = 'AUTO' | 'FORCE_OPEN' | 'FORCE_CLOSED';
export const DEFAULT_SERVICE_PERIOD: ServicePeriod = 'NIGHT';

export type AvailabilityCode =
  | 'OPEN'
  | 'CANTEEN_INACTIVE'
  | 'CANTEEN_NOT_ACCEPTING_ORDERS'
  | 'SERVICE_DISABLED'
  | 'SERVICE_CLOSED'
  | 'SERVICE_SCHEDULE_NOT_CONFIGURED';

export type ConfigurationWarning = 'AUTO_WITHOUT_SCHEDULE' | 'INVALID_SCHEDULE';

export interface AvailabilityInput {
  canteen: { isActive: boolean; isAcceptingOrders: boolean };
  service: { isEnabled: boolean; override: ScheduleOverride } | null;
  schedules: readonly OperatingScheduleRow[];
  now?: Date;
}

export interface AvailabilityResult {
  open: boolean;
  code: AvailabilityCode;
  message: string;
  warnings: ConfigurationWarning[];
}

const MESSAGES: Record<Exclude<AvailabilityCode, 'OPEN'>, string> = {
  CANTEEN_INACTIVE: 'This canteen is currently unavailable.',
  CANTEEN_NOT_ACCEPTING_ORDERS: 'This canteen is currently not accepting orders.',
  SERVICE_DISABLED: 'This service is not available.',
  SERVICE_CLOSED: 'This service is currently closed.',
  SERVICE_SCHEDULE_NOT_CONFIGURED: 'The service schedule has not been configured.',
};

function closed(code: Exclude<AvailabilityCode, 'OPEN'>, warnings: ConfigurationWarning[] = []): AvailabilityResult {
  return { open: false, code, message: MESSAGES[code], warnings };
}

/**
 * Shared canteen-service gate used by quotes, order creation, and `isOpenNow`.
 * Time is always the injected instant converted to Asia/Kolkata — never a device clock.
 */
export function evaluateServiceAvailability(input: AvailabilityInput): AvailabilityResult {
  const now = input.now ?? systemClock();
  const warnings: ConfigurationWarning[] = [];

  if (!input.canteen.isActive) return closed('CANTEEN_INACTIVE');
  if (!input.canteen.isAcceptingOrders) return closed('CANTEEN_NOT_ACCEPTING_ORDERS');
  if (!input.service || !input.service.isEnabled) return closed('SERVICE_DISABLED');

  const inspection = inspectOperatingSchedules(input.schedules);
  if (!inspection.ok) warnings.push('INVALID_SCHEDULE');

  if (input.service.override === 'FORCE_CLOSED') return closed('SERVICE_CLOSED', warnings);
  if (input.service.override === 'FORCE_OPEN') {
    return { open: true, code: 'OPEN', message: 'This service is open.', warnings };
  }

  if (input.schedules.length === 0) {
    warnings.push('AUTO_WITHOUT_SCHEDULE');
    return closed('SERVICE_SCHEDULE_NOT_CONFIGURED', warnings);
  }
  if (!inspection.ok) return closed('SERVICE_SCHEDULE_NOT_CONFIGURED', warnings);

  if (isWithinOperatingWindow(input.schedules, now)) {
    return { open: true, code: 'OPEN', message: 'This service is open.', warnings };
  }
  return closed('SERVICE_CLOSED', warnings);
}

export function assertServiceOpen(result: AvailabilityResult): void {
  if (result.open) return;
  throw new ConflictError(result.message, result.code);
}

export function resolveClock(clock?: Clock): Clock {
  return clock ?? systemClock;
}
