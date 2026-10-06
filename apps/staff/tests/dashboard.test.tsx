import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DashboardPage } from '../src/pages/DashboardPage';
import { canteen, dashboard, fakeStaffApi, order, renderStaff } from './fixtures';

describe('staff dashboard', () => {
  it('shows the counters returned by the backend', async () => {
    const api = fakeStaffApi();
    api.dashboard.mockResolvedValue(dashboard({ awaitingPreparation: 4, preparing: 2, ready: 1 }));
    api.orders.mockResolvedValue({ data: [order('PAYMENT_CONFIRMED')], nextCursor: null });
    renderStaff(<DashboardPage />, { api });
    const stat = async (label: string) => (await screen.findByText(label)).closest('.stat')!;
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
      isAcceptingOrders: false,
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
});
