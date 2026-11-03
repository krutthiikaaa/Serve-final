import type {
  AdminCanteenService,
  AdminConfigurationWarning,
  AdminConfigurationWarningCode,
  PublicCanteen,
  ServicePeriod,
} from '@serve/contracts';

export const PERIOD_LABEL: Record<ServicePeriod, string> = {
  DAY: 'Day',
  NIGHT: 'Night',
};

export const OVERRIDE_LABEL = {
  AUTO: 'Automatic (follow hours)',
  FORCE_OPEN: 'Temporarily forced open',
  FORCE_CLOSED: 'Temporarily forced closed',
} as const;

export const WARNING_COPY: Record<AdminConfigurationWarningCode, string> = {
  AUTO_WITHOUT_SCHEDULE:
    'Automatic hours are on, but no weekly schedule is set. Students will see this service as closed until you add hours or force it open.',
  INVALID_SCHEDULE:
    'This schedule is invalid. Opening and closing cannot be the same, and an overnight window must not overlap the next day’s opening time.',
  SERVICE_WITHOUT_MENU_PRICES:
    'Some menu items do not have a price for this service. Set Day and Night prices in the menu section.',
  SERVICE_DISABLED: 'This service is turned off. Students cannot order it.',
  PERIOD_SCHEDULE_OVERLAP:
    'Day and Night hours overlap. Neither schedule was changed — adjust one of them if that is not intended.',
};

export const CAPABILITY_LABEL = {
  KITCHEN: 'Kitchen',
  MENU: 'Menu',
  PAUSE: 'Pause orders',
  CASHIER: 'Cashier',
} as const;

export function warningText(warning: AdminConfigurationWarning): string {
  const prefix =
    warning.period && warning.code !== 'PERIOD_SCHEDULE_OVERLAP'
      ? `${PERIOD_LABEL[warning.period]}: `
      : '';
  return `${prefix}${WARNING_COPY[warning.code]}`;
}

export type ServiceStatusView =
  | { label: 'Currently open'; tone: 'success' }
  | { label: 'Currently closed'; tone: 'neutral' }
  | { label: 'Temporarily forced open'; tone: 'info' }
  | { label: 'Temporarily forced closed'; tone: 'warning' }
  | { label: 'Schedule not configured'; tone: 'warning' }
  | { label: 'Service disabled'; tone: 'danger' }
  | { label: 'Not configured'; tone: 'neutral' };

/**
 * Maps backend service fields + `isOpenNow` from GET /api/canteens/:id.
 * Does not evaluate clocks or schedules in the browser.
 */
export function serviceStatus(
  service: AdminCanteenService | undefined,
  live: PublicCanteen | undefined,
): ServiceStatusView {
  if (!service) return { label: 'Not configured', tone: 'neutral' };
  if (!service.isEnabled) return { label: 'Service disabled', tone: 'danger' };
  if (service.override === 'FORCE_OPEN') return { label: 'Temporarily forced open', tone: 'info' };
  if (service.override === 'FORCE_CLOSED')
    return { label: 'Temporarily forced closed', tone: 'warning' };
  if (service.override === 'AUTO' && service.schedules.length === 0) {
    return { label: 'Schedule not configured', tone: 'warning' };
  }
  const openNow = live?.services.find((row) => row.period === service.period)?.isOpenNow;
  if (openNow === true) return { label: 'Currently open', tone: 'success' };
  if (openNow === false) return { label: 'Currently closed', tone: 'neutral' };
  return { label: 'Currently closed', tone: 'neutral' };
}
