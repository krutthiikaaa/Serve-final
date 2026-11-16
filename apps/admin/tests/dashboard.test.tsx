import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardPage } from '../src/pages/DashboardPage';
import { adminDashboard, changeRequest, fakeAdminApi, renderAdmin, staffOrder } from './fixtures';

describe('admin dashboard', () => {
  it('shows backend figures, including orders awaiting preparation', async () => {
    const api = fakeAdminApi();
    api.dashboard.mockResolvedValue(adminDashboard());
    api.orders.mockResolvedValue({ data: [], nextCursor: null });
    renderAdmin(<DashboardPage />, { api });
    const stat = async (label: string) =>
      (await screen.findByText(label)).closest('.kpi, .summary-row')!;
    expect(await stat('Awaiting preparation')).toHaveTextContent('3');
    expect(await stat("Today's revenue")).toHaveTextContent('₹5,125');
    expect(await stat('Open services')).toHaveTextContent('3');
    expect(await stat("Today's walk-in orders")).toHaveTextContent('12');
    expect(await stat('Pending requests')).toHaveTextContent('2');
    expect(await stat('Cashiers')).toHaveTextContent('2');
    expect(screen.getByText(/2 staff requests are waiting for review/)).toBeInTheDocument();
    expect(screen.getByText(/in test\s+mode, showing a placeholder QR/)).toBeInTheDocument();
    expect(screen.queryByText(/DEMO mode/)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/missing official UPI/);
    expect(screen.getByText('Vedavathi Night Canteen')).toBeInTheDocument();
    expect(screen.getByText('Vedavathi Day Canteen')).toBeInTheDocument();
    const dayRow = screen.getByText('Vedavathi Day Canteen').closest('tr')!;
    expect(within(dayRow).getByText('Off duty')).toBeInTheDocument();
    const offDutyCount = screen
      .getAllByText('Off duty')
      .map((el) => el.closest('.summary-row'))
      .find(Boolean);
    expect(offDutyCount).toHaveTextContent('0');
    expect(await stat('Day canteens')).toHaveTextContent('5');
  });

  it('marks a simulated walk-in order without treating it as a student order', async () => {
    const api = fakeAdminApi();
    api.dashboard.mockResolvedValue(adminDashboard());
    api.orders.mockResolvedValue({ data: [staffOrder()], nextCursor: null });
    renderAdmin(<DashboardPage />, { api });
    expect(await screen.findByText('Walk-in · Guest')).toBeInTheDocument();
    expect(screen.getByText('NIGHT')).toBeInTheDocument();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    expect(screen.queryByText('DEMO')).not.toBeInTheDocument();
    expect(screen.queryByText('Student')).not.toBeInTheDocument();
  });

  it('refreshes when a change request arrives', async () => {
    const api = fakeAdminApi();
    api.dashboard.mockResolvedValue(adminDashboard());
    api.orders.mockResolvedValue({ data: [], nextCursor: null });
    const { fake } = renderAdmin(<DashboardPage />, { api });
    await screen.findByText('No orders yet');
    act(() => fake.serverEmit('change_request.created', { changeRequest: changeRequest() }));
    await waitFor(() => expect(api.dashboard).toHaveBeenCalledTimes(2));
    expect(api.orders).toHaveBeenCalledTimes(1);
  });
});
