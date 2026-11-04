import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotificationsProvider, useAuth } from '@serve/web-shared';
import { ActivityPage } from '../src/pages/ActivityPage';
import { SettingsPage } from '../src/pages/SettingsPage';
import { NotificationsPage } from '../src/pages/NotificationsPage';
import { fakeAdminApi, renderAdmin } from './fixtures';

function NotificationsHarness() {
  const { api } = useAuth();
  return (
    <NotificationsProvider api={api}>
      <NotificationsPage />
    </NotificationsProvider>
  );
}

describe('activity logs', () => {
  it('explains that audit history is not stored', () => {
    const api = fakeAdminApi();
    renderAdmin(<ActivityPage />, { api });
    expect(screen.getByText(/does not keep a queryable audit history/)).toBeInTheDocument();
    expect(screen.getByText('admin.canteen.payment_mode.update')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /yesterday/i })).not.toBeInTheDocument();
  });
});

describe('settings', () => {
  it('shows the university display settings from the backend', async () => {
    const api = fakeAdminApi();
    api.settings.mockResolvedValue({
      universityName: 'Vellore Institute of Technology',
      timezone: 'Asia/Kolkata',
      contact: null,
    });
    renderAdmin(<SettingsPage />, { api });
    expect(await screen.findByText('Vellore Institute of Technology')).toBeInTheDocument();
    expect(screen.getByText('Asia/Kolkata')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.queryByText(/DATABASE_URL|SECRET|API_KEY/)).not.toBeInTheDocument();
  });
});

describe('notifications', () => {
  it('does not invent operational warnings as notifications', () => {
    const api = fakeAdminApi();
    renderAdmin(<NotificationsHarness />, { api });
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText(/are not stored as notifications/)).toBeInTheDocument();
  });
});
