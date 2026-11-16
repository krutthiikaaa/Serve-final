import { act, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DashboardPage } from '../src/pages/DashboardPage';
import { StaffLayout } from '../src/components/StaffLayout';
import {
  CANTEEN_ID,
  canteen,
  dashboard,
  fakeStaffApi,
  meStaff,
  order,
  renderStaff,
} from './fixtures';

describe('staff dashboard', () => {
  it('shows the counters returned by the backend', async () => {
    const api = fakeStaffApi();
    api.dashboard.mockResolvedValue(dashboard({ awaitingPreparation: 4, preparing: 2, ready: 1 }));
    api.orders.mockResolvedValue({ data: [order('PAYMENT_CONFIRMED')], nextCursor: null });
    renderStaff(<DashboardPage />, { api });
    const stat = async (label: string) => (await screen.findByText(label)).closest('.kpi')!;
    expect(await stat('Awaiting preparation')).toHaveTextContent('4');
    expect(await stat('Preparing')).toHaveTextContent('2');
    expect(await stat('Ready for pickup')).toHaveTextContent('1');
    expect(await stat("Today's orders")).toHaveTextContent('14');
    expect(await stat("Today's revenue")).toHaveTextContent('₹1,860');
  });

  it('pauses order-taking through the backend', async () => {
    const api = fakeStaffApi();
    api.dashboard.mockResolvedValueOnce(dashboard()).mockResolvedValue(dashboard({}, false));
    api.orders.mockResolvedValue({ data: [], nextCursor: null });
    api.setAcceptingOrders.mockResolvedValue({
      ...canteen,
      isPaused: true,
      status: 'PAUSED',
    });
    renderStaff(<DashboardPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Pause orders' }));
    expect(api.setAcceptingOrders).toHaveBeenCalledWith(false);
    expect(await screen.findByRole('button', { name: 'Resume orders' })).toBeInTheDocument();
    expect(screen.getByText(/Order-taking is paused/)).toBeInTheDocument();
  });

  it('refetches the counters when an order event arrives', async () => {
    const api = fakeStaffApi();
    api.dashboard.mockResolvedValue(dashboard());
    api.orders.mockResolvedValue({ data: [], nextCursor: null });
    const { fake } = renderStaff(<DashboardPage />, { api });
    expect(await screen.findByText('No active orders')).toBeInTheDocument();
    act(() =>
      fake.serverEmit('order.payment_confirmed', {
        order: order('PAYMENT_CONFIRMED'),
        previousStatus: 'PLACED',
      }),
    );
    await waitFor(() => expect(api.dashboard).toHaveBeenCalledTimes(2));
  });

  it('hides pause and kitchen queues without those capabilities', async () => {
    const api = fakeStaffApi();
    api.dashboard.mockResolvedValue(dashboard());
    renderStaff(<DashboardPage />, {
      api,
      me: meStaff({
        assignments: [
          {
            canteenId: CANTEEN_ID,
            canteen: {
              id: CANTEEN_ID,
              name: canteen.name,
              type: 'NIGHT',
              isActive: true,
              isAcceptingOrders: true,
              isPaused: false,
            },
            capabilities: ['CASHIER'],
          },
        ],
      }),
    });
    expect(await screen.findByText('Payment pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause orders' })).not.toBeInTheDocument();
    expect(screen.queryByText('Awaiting preparation')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Active orders' })).not.toBeInTheDocument();
    expect(api.orders).not.toHaveBeenCalled();
  });
});

describe('one name for the canteen state', () => {
  const offDuty = {
    ...canteen,
    isAcceptingOrders: false,
    status: 'PAUSED' as const,
    availability: {
      ...canteen.availability,
      state: 'OTHER_SERVICE_ACTIVE' as const,
      isOpenNow: false,
      message: 'Krishna & Godavari Day Canteen is serving this area right now.',
      otherServiceCanteen: {
        id: '00000000-0000-4000-8000-0000000000d1',
        name: 'Krishna & Godavari Day Canteen',
        type: 'DAY' as const,
      },
    },
  };

  it('header and dashboard both say "Off duty" while the other canteen serves', async () => {
    const api = fakeStaffApi();
    api.dashboard.mockResolvedValue({ ...dashboard(), canteen: offDuty });
    api.orders.mockResolvedValue({ data: [], nextCursor: null });
    const me = meStaff({
      canteen: {
        id: CANTEEN_ID,
        name: canteen.name,
        type: 'NIGHT',
        isActive: true,
        isAcceptingOrders: false,
        isPaused: false,
        availability: offDuty.availability,
      },
    });
    renderStaff(
      <Routes>
        <Route element={<StaffLayout me={me} />}>
          <Route index element={<DashboardPage />} />
        </Route>
      </Routes>,
      { api, me },
    );
    const banner = await screen.findByRole('region', { name: 'Canteen status' });
    expect(within(banner).getByText('Off duty')).toBeInTheDocument();
    expect(within(banner).getByText(/is serving this area now/)).toBeInTheDocument();
    const header = document.querySelector('.topbar-title') as HTMLElement;
    expect(within(header).getByText('Off duty')).toBeInTheDocument();
    expect(screen.queryByText('Paused')).not.toBeInTheDocument();
    // Off duty is not a pause: nothing for staff to pause or resume here.
    expect(screen.queryByRole('button', { name: /Pause orders|Resume orders/ })).toBeNull();
  });

  it('shows "Closed by schedule" with the opening time, and keeps a pause visible', async () => {
    const api = fakeStaffApi();
    api.dashboard.mockResolvedValue({
      ...dashboard(),
      canteen: {
        ...offDuty,
        isPaused: true,
        availability: {
          ...offDuty.availability,
          state: 'CLOSED_BY_SCHEDULE',
          message: 'Closed by schedule. Opens at 18:00.',
          otherServiceCanteen: null,
        },
      },
    });
    api.orders.mockResolvedValue({ data: [], nextCursor: null });
    renderStaff(<DashboardPage />, { api });
    const banner = await screen.findByRole('region', { name: 'Canteen status' });
    expect(within(banner).getByText('Closed by schedule')).toBeInTheDocument();
    expect(within(banner).getByText(/Opens at 18:00/)).toBeInTheDocument();
    expect(within(banner).getByText(/Your pause stays in place/)).toBeInTheDocument();
    // Staff may lift their own pause even while closed by schedule.
    expect(within(banner).getByRole('button', { name: 'Resume orders' })).toBeInTheDocument();
  });
});
