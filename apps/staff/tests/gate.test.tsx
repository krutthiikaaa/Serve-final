import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '@serve/contracts';
import { ToastProvider, type AuthContextValue } from '@serve/web-shared';
import { FakeAuthProvider } from '@serve/web-shared/testing';
import { Gate } from '../src/App';
import { meStaff } from './fixtures';

// The gate opens a real socket for registered staff; keep it offline in tests.
vi.mock('socket.io-client', () => ({
  io: () => ({ on() {}, off() {}, removeAllListeners() {}, disconnect() {}, connect() {} }),
}));

function renderGate(me: Me | null, path = '/', overrides: Partial<AuthContextValue> = {}) {
  return render(
    <ToastProvider>
      <FakeAuthProvider me={me} overrides={overrides}>
        <MemoryRouter initialEntries={[path]}>
          <Gate />
        </MemoryRouter>
      </FakeAuthProvider>
    </ToastProvider>,
  );
}

describe('staff routing (decided only by /api/auth/me)', () => {
  it('shows email + password sign-in when signed out, and never Google', () => {
    renderGate(null);
    expect(screen.getByRole('heading', { name: 'Staff dashboard' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request access' })).toHaveAttribute(
      'href',
      '/create-account',
    );
  });

  it('shows why a sign-in was refused', () => {
    renderGate(null, '/', { signInError: 'Incorrect email or password.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('request access is a registration form, without Google', () => {
    renderGate(null, '/create-account');
    expect(screen.getByRole('heading', { name: 'Request staff access' })).toBeInTheDocument();
    for (const label of ['Full name', 'Email', 'Password', 'Confirm password']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Canteen you work at')).toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
  });

  it('protected pages are never shown while signed out', () => {
    renderGate(null, '/orders');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
  });

  it('old SSO handoff links open the dashboard with the existing session', () => {
    renderGate(meStaff(), '/sso/callback?code=old-one-time-code');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('turns away an unregistered (student Google) identity', () => {
    renderGate({ registered: false, role: null, authUserId: 'u', email: 'new@srmap.edu.in' });
    expect(
      screen.getByText('Use the SERVE mobile app to order.', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
  });

  it('keeps pending staff on the awaiting-approval screen', () => {
    renderGate(
      meStaff({
        status: 'PENDING',
        canteen: null,
        pendingChangeRequest: {
          id: '11111111-1111-4111-8111-111111111111',
          status: 'PENDING',
          createdAt: '2026-10-06T18:00:00.000Z',
          requestedCanteen: {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Vedavathi Night Canteen',
          },
        },
      }),
      '/orders',
    );
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.getByText('Your account is awaiting staff approval.')).toBeInTheDocument();
    expect(screen.getByText('Vedavathi Night Canteen')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
  });

  it('lets rejected staff request access again', () => {
    renderGate(meStaff({ status: 'REJECTED', canteen: null }));
    expect(screen.getByText('Request not approved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument();
  });

  it('locks out deactivated staff', () => {
    renderGate(meStaff({ status: 'DEACTIVATED', canteen: null }));
    expect(screen.getByText('Access removed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
  });

  it.each([
    ['STUDENT', 'Use the SERVE mobile app to order.'],
    ['ADMIN', 'Use the admin portal instead.'],
  ] as const)('turns away %s accounts', (role, text) => {
    const base = {
      registered: true as const,
      id: '33333333-3333-4333-8333-333333333333',
      authUserId: 'u',
      name: 'X',
      email: 'x@serve.dev',
      isActive: true,
    };
    const me: Me =
      role === 'ADMIN'
        ? { ...base, role }
        : {
            ...base,
            role,
            hostel: { id: base.id, name: 'Krishna' },
            serviceArea: { id: base.id, name: 'Krishna & Godavari' },
            defaultCanteen: {
              id: base.id,
              name: 'K&G',
              type: 'NIGHT',
              isActive: true,
              isAcceptingOrders: true,
              isPaused: false,
            },
          };
    renderGate(me);
    expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
  });

  it('opens the dashboard for approved staff with their assigned canteen', () => {
    renderGate(meStaff());
    expect(screen.getByRole('link', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getAllByText('Krishna & Godavari Night Canteen').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('never shows a canteen switcher and shows only authorised nav', () => {
    renderGate(
      meStaff({
        assignments: [
          {
            canteenId: '7d2c6a52-6f3e-4a35-9a3b-1c2d3e4f5a60',
            canteen: {
              id: '7d2c6a52-6f3e-4a35-9a3b-1c2d3e4f5a60',
              name: 'Krishna & Godavari Night Canteen',
              type: 'NIGHT',
              isActive: true,
              isAcceptingOrders: true,
              isPaused: false,
            },
            capabilities: ['CASHIER'],
          },
          {
            canteenId: '8d2c6a52-6f3e-4a35-9a3b-1c2d3e4f5a61',
            canteen: {
              id: '8d2c6a52-6f3e-4a35-9a3b-1c2d3e4f5a61',
              name: 'Yamuna & Narmada Night Canteen',
              type: 'NIGHT',
              isActive: true,
              isAcceptingOrders: true,
              isPaused: false,
            },
            capabilities: ['CASHIER'],
          },
        ],
      }),
    );
    expect(screen.queryByLabelText('Selected canteen')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Yamuna & Narmada Night Canteen')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cashier' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Menu' })).not.toBeInTheDocument();
  });
});
