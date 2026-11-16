import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '@serve/contracts';
import { ToastProvider } from '@serve/web-shared';
import { FakeAuthProvider } from '@serve/web-shared/testing';
import { Gate } from '../src/App';
import { meAdmin } from './fixtures';

vi.mock('socket.io-client', () => ({
  io: () => ({ on() {}, off() {}, removeAllListeners() {}, disconnect() {}, connect() {} }),
}));

const renderGate = (me: Me | null, path = '/') =>
  render(
    <ToastProvider>
      <FakeAuthProvider me={me}>
        <MemoryRouter initialEntries={[path]}>
          <Gate />
        </MemoryRouter>
      </FakeAuthProvider>
    </ToastProvider>,
  );

describe('admin routing (decided only by /api/auth/me)', () => {
  it('shows Google sign-in (SRM accounts) and no self-registration when signed out', () => {
    renderGate(null);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByText('@srmap.edu.in')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByText(/create account/i)).not.toBeInTheDocument();
  });

  it('old SSO handoff links open the portal with the shared session', () => {
    renderGate(meAdmin(), '/sso/callback?code=old-one-time-code');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('refuses staff accounts', () => {
    renderGate({
      registered: true,
      id: '00000000-0000-4000-8000-000000000001',
      authUserId: 'u',
      name: 'S',
      email: 's@serve.dev',
      isActive: true,
      role: 'STAFF',
      status: 'APPROVED',
      canteen: null,
      assignments: [],
      pendingChangeRequest: null,
    });
    expect(screen.getByText('Not an admin account')).toBeInTheDocument();
    expect(screen.getByText(/Use the staff dashboard instead/)).toBeInTheDocument();
  });

  it('refuses Google users without a SERVE admin account', () => {
    renderGate({ registered: false, role: null, authUserId: 'u', email: 'x@srmap.edu.in' });
    expect(
      screen.getByText('This account is not registered as a SERVE admin.'),
    ).toBeInTheDocument();
  });

  it('refuses a disabled admin', () => {
    renderGate(meAdmin({ isActive: false }));
    expect(screen.getByText('Admin access disabled')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Canteens' })).not.toBeInTheDocument();
  });

  it('opens the portal for an active admin', () => {
    renderGate(meAdmin());
    const sidebar = within(screen.getByRole('complementary', { name: 'Admin portal navigation' }));
    for (const name of [
      'Dashboard',
      'Canteens',
      'Menu',
      'Staff',
      'Change requests',
      'Payments',
      'Reports',
      'Notifications',
      'Activity',
      'Settings',
    ]) {
      expect(sidebar.getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
  });
});
