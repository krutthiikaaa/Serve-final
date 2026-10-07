import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '@serve/contracts';
import { ToastProvider } from '@serve/web-shared';
import { FakeAuthProvider } from '@serve/web-shared/testing';
import { Gate } from '../src/App';
import { meStaff } from './fixtures';

// The gate opens a real socket for registered staff; keep it offline in tests.
vi.mock('socket.io-client', () => ({
  io: () => ({ on() {}, off() {}, removeAllListeners() {}, disconnect() {}, connect() {} }),
}));

function renderGate(me: Me | null, path = '/') {
  return render(
    <ToastProvider>
      <FakeAuthProvider me={me}>
        <MemoryRouter initialEntries={[path]}>
          <Gate />
        </MemoryRouter>
      </FakeAuthProvider>
    </ToastProvider>,
  );
}

describe('staff routing (decided only by /api/auth/me)', () => {
  it('shows sign-in when signed out', () => {
    renderGate(null);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('asks a new Firebase user to complete staff registration', () => {
    renderGate({ registered: false, role: null, firebaseUid: 'u', email: 'new@serve.dev' });
    expect(screen.getByRole('heading', { name: 'Your staff details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request access' })).toBeDisabled();
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
      firebaseUid: 'u',
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
            defaultCanteen: { id: base.id, name: 'K&G', isActive: true, isAcceptingOrders: true },
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
});
