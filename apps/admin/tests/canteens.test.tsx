import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@serve/web-shared';
import type { AdminCanteen, ServiceArea } from '@serve/contracts';
import { CanteensPage } from '../src/pages/CanteensPage';
import { areaClock } from '../src/pages/canteen/AreaSchedule';
import {
  AREA,
  adminCanteen,
  availability,
  fakeAdminApi,
  renderAdmin,
  serviceArea,
} from './fixtures';

const row = (name: string) => screen.getByRole('link', { name }).closest('tr')!;

function setup(canteens: AdminCanteen[]) {
  const api = fakeAdminApi();
  api.canteens.mockResolvedValue(canteens);
  api.serviceAreas.mockResolvedValue([serviceArea(canteens)]);
  return api;
}

const night = (overrides: Partial<AdminCanteen> = {}) =>
  adminCanteen('Krishna & Godavari Night Canteen', { type: 'NIGHT', ...overrides });
const day = (overrides: Partial<AdminCanteen> = {}) =>
  adminCanteen('Krishna & Godavari Day Canteen', {
    type: 'DAY',
    isAcceptingOrders: false,
    status: 'PAUSED',
    availability: availability('OTHER_SERVICE_ACTIVE'),
    ...overrides,
  });

describe('canteens grouped by service area', () => {
  it('shows each area with its Day and Night canteen, type and availability', async () => {
    const api = setup([
      night({ staffAccount: { id: 'x', name: 'K&G Night', email: 'kg.night@serve.dev' } }),
      day(),
    ]);
    renderAdmin(<CanteensPage />, { api });
    expect(await screen.findByRole('heading', { name: AREA.name })).toBeInTheDocument();
    const nightRow = row('Krishna & Godavari Night Canteen');
    expect(within(nightRow).getByText('Night')).toBeInTheDocument();
    expect(within(nightRow).getByText('Taking orders')).toBeInTheDocument();
    expect(within(nightRow).getByText('kg.night@serve.dev')).toBeInTheDocument();
    const dayRow = row('Krishna & Godavari Day Canteen');
    expect(within(dayRow).getByText('Day')).toBeInTheDocument();
    expect(within(dayRow).getByText('Off duty')).toBeInTheDocument();
    expect(within(dayRow).getByText('Not assigned')).toBeInTheDocument();
    // The off-duty canteen cannot be resumed directly: switch the area instead.
    expect(within(dayRow).queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('switches the area’s active service in one action', async () => {
    const n = night();
    const d = day();
    const api = setup([n, d]);
    api.setActiveService.mockResolvedValue(serviceArea([n, d], { openCanteenId: d.id }));
    renderAdmin(<CanteensPage />, { api });
    const group = await screen.findByRole('group', { name: 'Taking orders' });
    expect(within(group).getByRole('button', { name: 'Night' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(group).getByRole('button', { name: 'Day' }));
    expect(api.setActiveService).toHaveBeenCalledWith(AREA.id, d.id);
    await userEvent.click(within(group).getByRole('button', { name: 'Neither' }));
    expect(api.setActiveService).toHaveBeenCalledWith(AREA.id, null);
  });

  it('filters by type and by name', async () => {
    const api = setup([night(), day()]);
    renderAdmin(<CanteensPage />, { api });
    await screen.findByText('Krishna & Godavari Night Canteen');
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Filter by type' })).getByRole('button', {
        name: 'Day',
      }),
    );
    expect(screen.queryByText('Krishna & Godavari Night Canteen')).not.toBeInTheDocument();
    expect(screen.getByText('Krishna & Godavari Day Canteen')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search canteens'), 'zzz');
    expect(screen.getByText('No canteens match this search')).toBeInTheDocument();
  });

  it('pauses order-taking', async () => {
    const n = night();
    const api = setup([n]);
    api.updateCanteen.mockResolvedValue({ ...n, isPaused: true, status: 'PAUSED' });
    renderAdmin(<CanteensPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    // A pause is its own flag: the canteen stays on duty and the schedule never lifts it.
    expect(api.updateCanteen).toHaveBeenCalledWith(n.id, { isPaused: true });
  });

  it('resumes a paused canteen by lifting the pause only', async () => {
    const n = night({ isPaused: true, status: 'PAUSED', availability: availability('PAUSED') });
    const api = setup([n, day()]);
    api.updateCanteen.mockResolvedValue({ ...n, isPaused: false });
    renderAdmin(<CanteensPage />, { api });
    const nightRow = await waitFor(() => row('Krishna & Godavari Night Canteen'));
    expect(within(nightRow).getByText('Paused')).toBeInTheDocument();
    await userEvent.click(within(nightRow).getByRole('button', { name: 'Resume' }));
    expect(api.updateCanteen).toHaveBeenCalledWith(n.id, { isPaused: false });
  });

  it('asks for confirmation before deactivating', async () => {
    const n = night();
    const api = setup([n]);
    api.updateCanteen.mockResolvedValue({ ...n, isActive: false, status: 'INACTIVE' });
    renderAdmin(<CanteensPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect(api.updateCanteen).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', {
      name: 'Deactivate Krishna & Godavari Night Canteen?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(api.updateCanteen).toHaveBeenCalledWith(n.id, { isActive: false });
  });

  it('offers to add the missing Day canteen of an area', async () => {
    const api = setup([night()]);
    api.createCanteen.mockImplementation(async (body) => adminCanteen(body.name, { type: 'DAY' }));
    renderAdmin(<CanteensPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Add Day canteen' }));
    const dialog = screen.getByRole('dialog', { name: 'Add canteen' });
    expect(within(dialog).getByRole('radio', { name: /Day/ })).toBeChecked();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'K&G Day Canteen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add canteen' }));
    await waitFor(() =>
      expect(api.createCanteen).toHaveBeenCalledWith({
        name: 'K&G Day Canteen',
        type: 'DAY',
        serviceAreaId: AREA.id,
        location: null,
        openingHours: null,
      }),
    );
  });

  it('requires a canteen type, never asks for a slug, and can create a new area', async () => {
    const api = setup([]);
    api.serviceAreas.mockResolvedValue([]);
    api.createCanteen.mockImplementation(async (body) => adminCanteen(body.name));
    renderAdmin(<CanteensPage />, { api });
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add canteen' }))[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Add canteen' });
    expect(within(dialog).queryByLabelText(/slug/i)).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Saraswati Night Canteen');
    await userEvent.type(within(dialog).getByLabelText('New area name'), 'Saraswati');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add canteen' }));
    expect(within(dialog).getByText('Choose Day or Night')).toBeInTheDocument();
    expect(api.createCanteen).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('radio', { name: /Night/ }));
    await userEvent.type(within(dialog).getByLabelText('Location'), 'Near Saraswati block');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add canteen' }));
    await waitFor(() =>
      expect(api.createCanteen).toHaveBeenCalledWith({
        name: 'Saraswati Night Canteen',
        type: 'NIGHT',
        serviceAreaName: 'Saraswati',
        location: 'Near Saraswati block',
        openingHours: null,
      }),
    );
  });
});

const OVERLAP = 'Day and Night hours overlap. One canteen serves at a time.';

/**
 * A fixed "now" for the schedule tests: 16 Nov 2026, 20:30 in Asia/Kolkata,
 * while the Night canteen serves. Its next change — closing at 06:00 IST,
 * 2026-11-17T00:30Z — is "tomorrow" relative to this clock, whatever the
 * real date is. Only Date is faked; timers stay real for user events.
 */
const NOW = new Date('2026-11-16T15:00:00.000Z');
const NEXT_CLOSE = '2026-11-17T00:30:00.000Z';

describe('areaClock (next transition, in the area’s time zone)', () => {
  const tz = 'Asia/Kolkata';
  it('labels a time later today, tomorrow, or by weekday further out', () => {
    expect(areaClock('2026-11-16T16:30:00.000Z', tz, NOW)).toBe('22:00 today');
    expect(areaClock(NEXT_CLOSE, tz, NOW)).toBe('06:00 tomorrow');
    expect(areaClock('2026-11-18T01:30:00.000Z', tz, NOW)).toBe('Wed 07:00');
  });

  it('uses the area’s calendar day, not UTC’s', () => {
    // 2026-11-16T19:00Z is already 17 Nov 00:30 in Kolkata: "tomorrow" seen from
    // NOW, although it is the same UTC date as NOW.
    expect(areaClock('2026-11-16T19:00:00.000Z', tz, NOW)).toBe('00:30 tomorrow');
    // Just before local midnight it is still "today".
    expect(areaClock('2026-11-16T18:29:00.000Z', tz, NOW)).toBe('23:59 today');
  });
});

describe('Day/Night scheduling per area', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const scheduled = (n: AdminCanteen, d: AdminCanteen, overrides: Partial<ServiceArea> = {}) =>
    serviceArea([n, d], {
      schedule: {
        autoSwitchEnabled: true,
        timezone: 'Asia/Kolkata',
        day: { opensAt: '07:00', closesAt: '17:00' },
        night: { opensAt: '18:00', closesAt: '06:00' },
      },
      mode: 'AUTOMATIC',
      scheduledTarget: 'NIGHT',
      nextTransition: { at: NEXT_CLOSE, target: 'NONE' },
      ...overrides,
    });

  it('shows the mode, hours, time zone and next transition', async () => {
    const n = night();
    const d = day();
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([n, d]);
    api.serviceAreas.mockResolvedValue([scheduled(n, d)]);
    renderAdmin(<CanteensPage />, { api });
    const strip = await screen.findByRole('group', { name: `${AREA.name} schedule` });
    expect(within(strip).getByText('Automatic')).toBeInTheDocument();
    expect(within(strip).getByText(/07:00–17:00/)).toBeInTheDocument();
    expect(within(strip).getByText(/18:00–06:00/)).toBeInTheDocument();
    expect(within(strip).getByText(/Asia\/Kolkata/)).toBeInTheDocument();
    expect(
      within(strip).getByText('Follows the schedule. Next: closes at 06:00 tomorrow.'),
    ).toBeInTheDocument();
    expect(within(strip).queryByRole('button', { name: 'Restore automatic' })).toBeNull();
  });

  it('asks how long a manual switch overrides the schedule', async () => {
    const n = night();
    const d = day();
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([n, d]);
    api.serviceAreas.mockResolvedValue([scheduled(n, d)]);
    api.setActiveService.mockResolvedValue(scheduled(n, d, { mode: 'MANUAL_OVERRIDE' }));
    renderAdmin(<CanteensPage />, { api });
    const group = await screen.findByRole('group', { name: 'Taking orders' });
    await userEvent.click(within(group).getByRole('button', { name: 'Day' }));
    // Nothing changes until the admin confirms.
    expect(api.setActiveService).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Override the schedule?' });
    await userEvent.click(within(dialog).getByLabelText('Until I restore automatic switching'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Override' }));
    expect(api.setActiveService).toHaveBeenCalledWith(AREA.id, d.id, 'UNTIL_RESTORED');
  });

  it('defaults an override to the next scheduled change', async () => {
    const n = night();
    const d = day();
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([n, d]);
    api.serviceAreas.mockResolvedValue([scheduled(n, d)]);
    api.setActiveService.mockResolvedValue(scheduled(n, d));
    renderAdmin(<CanteensPage />, { api });
    const group = await screen.findByRole('group', { name: 'Taking orders' });
    await userEvent.click(within(group).getByRole('button', { name: 'Neither' }));
    const dialog = screen.getByRole('dialog', { name: 'Override the schedule?' });
    expect(within(dialog).getByLabelText(/Until the next scheduled change/)).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Override' }));
    expect(api.setActiveService).toHaveBeenCalledWith(AREA.id, null, 'NEXT_TRANSITION');
  });

  it('shows an override and restores automatic switching', async () => {
    const n = night();
    const d = day();
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([n, d]);
    api.serviceAreas.mockResolvedValue([
      scheduled(n, d, {
        mode: 'MANUAL_OVERRIDE',
        override: { target: 'NIGHT', until: null, setAt: '2026-11-16T06:00:00.000Z' },
      }),
    ]);
    api.restoreAutomatic.mockResolvedValue(scheduled(n, d));
    renderAdmin(<CanteensPage />, { api });
    const strip = await screen.findByRole('group', { name: `${AREA.name} schedule` });
    expect(within(strip).getByText('Manual override')).toBeInTheDocument();
    expect(
      within(strip).getByText(
        /Night canteen set by an admin until automatic switching is restored/,
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(strip).getByRole('button', { name: 'Restore automatic' }));
    expect(api.restoreAutomatic).toHaveBeenCalledWith(AREA.id);
  });

  it('edits the schedule and shows the server’s validation message', async () => {
    const n = night();
    const d = day();
    const api = setup([n, d]);
    api.updateAreaSchedule
      .mockRejectedValueOnce(
        new ApiError(422, 'INVALID_AREA_SCHEDULE', OVERLAP, [
          { path: 'nightOpensAtMinutes', message: OVERLAP },
        ]),
      )
      .mockResolvedValueOnce(scheduled(n, d));
    renderAdmin(<CanteensPage />, { api });
    const strip = await screen.findByRole('group', { name: `${AREA.name} schedule` });
    expect(within(strip).getByText('Manual')).toBeInTheDocument();
    await userEvent.click(within(strip).getByRole('button', { name: 'Edit schedule' }));
    const dialog = screen.getByRole('dialog', { name: `${AREA.name} schedule` });
    await userEvent.click(within(dialog).getByLabelText('Switch automatically'));
    const set = async (label: string, value: string) => {
      const input = within(dialog).getByLabelText(label);
      await userEvent.clear(input);
      await userEvent.type(input, value);
    };
    await set('Day opens', '07:00');
    await set('Day closes', '17:00');
    await set('Night opens', '16:00');
    await set('Night closes', '06:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    expect(api.updateAreaSchedule).toHaveBeenCalledWith(AREA.id, {
      autoSwitchEnabled: true,
      timezone: 'Asia/Kolkata',
      day: { opensAt: '07:00', closesAt: '17:00' },
      night: { opensAt: '16:00', closesAt: '06:00' },
    });
    expect(await within(dialog).findByText(OVERLAP)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Night opens')).toHaveAttribute('aria-invalid', 'true');
    await set('Night opens', '18:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
