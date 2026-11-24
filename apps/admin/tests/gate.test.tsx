import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '@serve/contracts';
import { ToastProvider, type AuthContextValue } from '@serve/web-shared';
import { FakeAuthProvider } from '@serve/web-shared/testing';
import { Gate } from '../src/App';
import { meAdmin } from './fixtures';

vi.mock('socket.io-client', () => ({
  io: () => ({ on() {}, off() {}, removeAllListeners() {}, disconnect() {}, connect() {} }),
}));

const renderGate = (me: Me | null, path = '/', overrides: Partial<AuthContextValue> = {}) =>
  render(
    <ToastProvider>
      <FakeAuthProvider me={me} overrides={overrides}>
        <MemoryRouter initialEntries={[path]}>
          <Gate />
        </MemoryRouter>
      </FakeAuthProvider>
    </ToastProvider>,
  );

describe('admin routing (decided only by /api/auth/me)', () => {
  it('shows email + password sign-in, no Google and no self-registration when signed out', () => {
    renderGate(null);
    expect(screen.getByRole('heading', { name: 'Admin portal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create account|request access/i)).not.toBeInTheDocument();
  });

  it('signs in with email and password', async () => {
    const signInWithPassword = vi.fn(async () => true);
    renderGate(null, '/', { signInWithPassword });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@srmap.edu.in' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'an-admin-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith('ada@srmap.edu.in', 'an-admin-password'),
    );
  });

  it('shows why a sign-in was refused', () => {
    renderGate(null, '/', { signInError: 'Incorrect email or password.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('protected pages are never shown while signed out', () => {
    renderGate(null, '/staff');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Canteens' })).not.toBeInTheDocument();
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

  it('refuses an identity without a SERVE admin account', () => {
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
