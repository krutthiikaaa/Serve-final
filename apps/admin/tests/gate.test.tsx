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

const renderGate = (me: Me | null) =>
  render(
    <ToastProvider>
      <FakeAuthProvider me={me}>
        <MemoryRouter>
          <Gate />
        </MemoryRouter>
      </FakeAuthProvider>
    </ToastProvider>,
  );

describe('admin routing (decided only by /api/auth/me)', () => {
  it('shows sign-in and no self-registration when signed out', () => {
    renderGate(null);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/create account/i)).not.toBeInTheDocument();
  });

  it('refuses staff accounts', () => {
    renderGate({
      registered: true,
      id: '00000000-0000-4000-8000-000000000001',
      firebaseUid: 'u',
      name: 'S',
      email: 's@serve.dev',
      isActive: true,
      role: 'STAFF',
      status: 'APPROVED',
      canteen: null,
      pendingChangeRequest: null,
    });
    expect(screen.getByText('Not an admin account')).toBeInTheDocument();
    expect(screen.getByText(/Use the staff dashboard instead/)).toBeInTheDocument();
  });

  it('refuses Firebase users without a SERVE account', () => {
    renderGate({ registered: false, role: null, firebaseUid: 'u', email: 'x@serve.dev' });
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
    for (const name of ['Dashboard', 'Canteens', 'Change requests', 'Staff', 'Notifications']) {
      expect(sidebar.getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
  });
});
