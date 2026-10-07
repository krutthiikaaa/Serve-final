import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardPage } from '../src/pages/DashboardPage';
import { adminDashboard, changeRequest, fakeAdminApi, renderAdmin } from './fixtures';

describe('admin dashboard', () => {
  it('shows backend figures, including orders awaiting preparation', async () => {
    const api = fakeAdminApi();
    api.dashboard.mockResolvedValue(adminDashboard());
    api.orders.mockResolvedValue({ data: [], nextCursor: null });
    renderAdmin(<DashboardPage />, { api });
    const stat = async (label: string) => (await screen.findByText(label)).closest('.stat')!;
    expect(await stat('Awaiting preparation')).toHaveTextContent('3');
    expect(await stat("Today's revenue")).toHaveTextContent('₹5,125');
    expect(await stat('Pending requests')).toHaveTextContent('2');
    expect(screen.getByText(/2 staff requests are waiting for review/)).toBeInTheDocument();
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
