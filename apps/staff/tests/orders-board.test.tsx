import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@serve/web-shared';
import { OrdersPage } from '../src/pages/OrdersPage';
import { advanced, deferred, fakeStaffApi, order, renderStaff } from './fixtures';

const column = (name: string) => screen.getByRole('region', { name });

describe('order board', () => {
  it('groups paid orders into New / Preparing / Ready columns', async () => {
    const api = fakeStaffApi();
    const fresh = order('PAYMENT_CONFIRMED');
    const cooking = order('PREPARING');
    const ready = order('READY');
    api.orders.mockResolvedValue({ data: [fresh, cooking, ready], nextCursor: null });
    renderStaff(<OrdersPage />, { api });

    await screen.findByText(fresh.orderNumber);
    expect(within(column('New')).getByText(fresh.orderNumber)).toBeInTheDocument();
    expect(within(column('Preparing')).getByText(cooking.orderNumber)).toBeInTheDocument();
    expect(within(column('Ready for pickup')).getByText(ready.orderNumber)).toBeInTheDocument();
    expect(api.orders).toHaveBeenCalledWith('active', { limit: 100 });
  });

  it('moves an order only after the backend confirms the transition (no optimistic success)', async () => {
    const api = fakeStaffApi();
    const o = order('PAYMENT_CONFIRMED');
    api.orders.mockResolvedValue({ data: [o], nextCursor: null });
    const pending = deferred<ReturnType<typeof advanced>>();
    api.setOrderStatus.mockReturnValue(pending.promise);
    renderStaff(<OrdersPage />, { api });

    await userEvent.click(await screen.findByRole('button', { name: 'Start preparing' }));
    expect(api.setOrderStatus).toHaveBeenCalledWith(o.id, 'PREPARING', undefined);
    // Still in "New" while the request is in flight.
    expect(within(column('New')).getByText(o.orderNumber)).toBeInTheDocument();

    await act(async () => pending.resolve(advanced(o, 'PREPARING')));
    expect(within(column('Preparing')).getByText(o.orderNumber)).toBeInTheDocument();
    expect(within(column('New')).queryByText(o.orderNumber)).not.toBeInTheDocument();
    expect(
      within(column('Preparing')).getByRole('button', { name: 'Mark ready' }),
    ).toBeInTheDocument();
  });

  it('shows the error and the server state when a transition conflicts (409)', async () => {
    const api = fakeStaffApi();
    const o = order('PREPARING');
    api.orders.mockResolvedValue({ data: [o], nextCursor: null });
    api.setOrderStatus.mockRejectedValue(
      new ApiError(409, 'INVALID_STATUS_TRANSITION', 'Order is already READY'),
    );
    api.order.mockResolvedValue(advanced(o, 'READY'));
    renderStaff(<OrdersPage />, { api });

    await userEvent.click(await screen.findByRole('button', { name: 'Mark ready' }));
    expect(await screen.findByText('Order is already READY')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(column('Ready for pickup')).getByText(o.orderNumber)).toBeInTheDocument(),
    );
    expect(api.order).toHaveBeenCalledWith(o.id);
  });

  it('adds a card and announces it when order.payment_confirmed arrives', async () => {
    const api = fakeStaffApi();
    api.orders.mockResolvedValue({ data: [], nextCursor: null });
    const { fake } = renderStaff(<OrdersPage />, { api });
    expect(await screen.findByText('New paid orders land here.')).toBeInTheDocument();

    const incoming = order('PAYMENT_CONFIRMED', { totalPaise: 9_950 });
    act(() =>
      fake.serverEmit('order.payment_confirmed', { order: incoming, previousStatus: 'PLACED' }),
    );
    expect(within(column('New')).getByText(incoming.orderNumber)).toBeInTheDocument();
    expect(screen.getByText(`New order ${incoming.orderNumber} · ₹99.50`)).toBeInTheDocument();
  });

  it('applies live status events and drops collected / cancelled orders from the board', async () => {
    const api = fakeStaffApi();
    const a = order('PAYMENT_CONFIRMED');
    const b = order('READY');
    api.orders.mockResolvedValue({ data: [a, b], nextCursor: null });
    const { fake } = renderStaff(<OrdersPage />, { api });
    await screen.findByText(a.orderNumber);

    act(() =>
      fake.serverEmit('order.preparing', {
        order: advanced(a, 'PREPARING'),
        previousStatus: 'PAYMENT_CONFIRMED',
      }),
    );
    expect(within(column('Preparing')).getByText(a.orderNumber)).toBeInTheDocument();
    act(() =>
      fake.serverEmit('order.collected', {
        order: advanced(b, 'COLLECTED'),
        previousStatus: 'READY',
      }),
    );
    expect(screen.queryByText(b.orderNumber)).not.toBeInTheDocument();
  });

  it('ignores a stale event that is older than the order on screen', async () => {
    const api = fakeStaffApi();
    const o = order('PAYMENT_CONFIRMED');
    const ready = advanced(advanced(o, 'PREPARING'), 'READY');
    api.orders.mockResolvedValue({ data: [ready], nextCursor: null });
    const { fake } = renderStaff(<OrdersPage />, { api });
    await screen.findByText(o.orderNumber);
    act(() =>
      fake.serverEmit('order.preparing', {
        order: advanced(o, 'PREPARING'),
        previousStatus: 'PAYMENT_CONFIRMED',
      }),
    );
    expect(within(column('Ready for pickup')).getByText(o.orderNumber)).toBeInTheDocument();
  });

  it('offers cancellation only before preparation and sends the reason', async () => {
    const api = fakeStaffApi();
    const fresh = order('PAYMENT_CONFIRMED');
    const cooking = order('PREPARING');
    api.orders.mockResolvedValue({ data: [fresh, cooking], nextCursor: null });
    api.setOrderStatus.mockResolvedValue(
      advanced(fresh, 'CANCELLED', { cancelReason: 'Out of bread' }),
    );
    renderStaff(<OrdersPage />, { api });

    await screen.findByText(fresh.orderNumber);
    expect(
      within(column('Preparing')).queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(column('New')).getByRole('button', { name: 'Cancel' }));
    const dialog = screen.getByRole('dialog', { name: `Cancel ${fresh.orderNumber}?` });
    await userEvent.type(
      within(dialog).getByLabelText('Reason (shown to the student)'),
      'Out of bread',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel order' }));

    expect(api.setOrderStatus).toHaveBeenCalledWith(fresh.id, 'CANCELLED', 'Out of bread');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(fresh.orderNumber)).not.toBeInTheDocument();
  });

  it('refetches the board after a reconnect', async () => {
    const api = fakeStaffApi();
    api.orders.mockResolvedValue({ data: [], nextCursor: null });
    const { reconnect } = renderStaff(<OrdersPage />, { api });
    await screen.findByText('New paid orders land here.');
    expect(api.orders).toHaveBeenCalledTimes(1);
    reconnect();
    await waitFor(() => expect(api.orders).toHaveBeenCalledTimes(2));
  });

  it('shows an error state with retry when the board cannot load', async () => {
    const api = fakeStaffApi();
    api.orders
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'x'))
      .mockResolvedValue({ data: [], nextCursor: null });
    renderStaff(<OrdersPage />, { api });
    expect(
      await screen.findByText('Unable to connect to SERVE. Please try again.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('New paid orders land here.')).toBeInTheDocument();
  });

  it('opens order details with items, total and timeline', async () => {
    const api = fakeStaffApi();
    const o = order('PAYMENT_CONFIRMED');
    api.orders.mockResolvedValue({ data: [o], nextCursor: null });
    renderStaff(<OrdersPage />, { api });
    await userEvent.click(
      await screen.findByRole('button', { name: `Order ${o.orderNumber} details` }),
    );
    const dialog = screen.getByRole('dialog', { name: `Order ${o.orderNumber}` });
    expect(within(dialog).getByText('Asha Rao')).toBeInTheDocument();
    expect(within(dialog).getByText('Payment confirmed')).toBeInTheDocument();
    expect(within(dialog).getByText('Paid · Test payment')).toBeInTheDocument();
  });

  it('lists collected orders in history', async () => {
    const api = fakeStaffApi();
    const done = order('COLLECTED', { collectedAt: '2026-10-06T19:30:00.000Z' });
    api.orders.mockImplementation(async (status) => ({
      data: status === 'COLLECTED' ? [done] : [],
      nextCursor: null,
    }));
    renderStaff(<OrdersPage />, { api });
    await screen.findByText('New paid orders land here.');
    await userEvent.click(screen.getByRole('tab', { name: 'Collected' }));
    expect(await screen.findByText(done.orderNumber)).toBeInTheDocument();
    expect(api.orders).toHaveBeenCalledWith('COLLECTED', { limit: 25 });
  });
});
