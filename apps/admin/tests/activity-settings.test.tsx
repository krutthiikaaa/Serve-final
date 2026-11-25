import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('settings: password change', () => {
  it('changes the admin password through the auth provider', async () => {
    const api = fakeAdminApi();
    api.settings.mockResolvedValue({
      universityName: 'SRM University-AP',
      timezone: 'Asia/Kolkata',
      contact: null,
    });
    const changePassword = vi.fn(async () => undefined);
    renderAdmin(<SettingsPage />, { api, auth: { changePassword } });
    expect(screen.getByRole('heading', { name: 'Password' })).toBeInTheDocument();
    const type = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type('Current password', 'old-admin-password');
    type('New password', 'new-admin-password');
    type('Confirm new password', 'new-admin-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-admin-password',
        newPassword: 'new-admin-password',
      }),
    );
    expect(await screen.findByText(/^Password changed\./)).toBeInTheDocument();
  });

  it('shows a refused password change', async () => {
    const api = fakeAdminApi();
    api.settings.mockResolvedValue({
      universityName: 'SRM',
      timezone: 'Asia/Kolkata',
      contact: null,
    });
    const changePassword = vi.fn(async () => {
      throw new Error('Your current password is incorrect.');
    });
    renderAdmin(<SettingsPage />, { api, auth: { changePassword } });
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'wrong-one-1' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-admin-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'new-admin-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your current password is incorrect.',
    );
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
