import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '@serve/contracts';
import { ApiError, ToastProvider, type AuthContextValue } from '@serve/web-shared';
import {
  FakeAuthProvider,
  FakeRealtimeProvider,
  createFakeSocket,
} from '@serve/web-shared/testing';
import type { StaffApi } from '../src/api/staff';
import { StaffApiContext } from '../src/useStaffApi';
import { StaffCanteenProvider } from '../src/staffCanteen';
import { LoginPage } from '../src/pages/LoginPage';
import { CreateAccountPage } from '../src/pages/CreateAccountPage';
import { AccountPage } from '../src/pages/AccountPage';
import { fakeStaffApi, meStaff } from './fixtures';

const DIRECTORY = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Krishna & Godavari',
    canteens: [
      { id: '20000000-0000-4000-8000-000000000001', name: 'K&G Day Canteen', type: 'DAY' },
      { id: '20000000-0000-4000-8000-000000000002', name: 'K&G Night Canteen', type: 'NIGHT' },
    ],
  },
] as const;

function renderSignedOut(ui: React.ReactNode, overrides: Partial<AuthContextValue> = {}) {
  const api = fakeStaffApi();
  api.serviceAreaDirectory.mockResolvedValue(
    DIRECTORY as unknown as Awaited<ReturnType<StaffApi['serviceAreaDirectory']>>,
  );
  const signInWithPassword = vi.fn(async (_email: string, _password: string) => true);
  render(
    <ToastProvider>
      <FakeAuthProvider me={null} overrides={{ signInWithPassword, ...overrides }}>
        <StaffApiContext.Provider value={api as unknown as StaffApi}>
          <MemoryRouter>{ui}</MemoryRouter>
        </StaffApiContext.Provider>
      </FakeAuthProvider>
    </ToastProvider>,
  );
  return { api, signInWithPassword };
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('staff login', () => {
  it('signs in with email and password', async () => {
    const { signInWithPassword } = renderSignedOut(<LoginPage />);
    type('Email', 'ravi@outlook.com');
    type('Password', 'correct-horse-battery');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith('ravi@outlook.com', 'correct-horse-battery'),
    );
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
  });
});

describe('staff registration', () => {
  const fillForm = (overrides: Partial<Record<string, string>> = {}) => {
    const values = {
      'Full name': 'Ravi Kumar',
      Email: 'ravi.kumar@gmail.com',
      Password: 'correct-horse-battery',
      'Confirm password': 'correct-horse-battery',
      ...overrides,
    };
    for (const [label, value] of Object.entries(values)) type(label, value!);
  };

  it('lists the public canteens and registers a PENDING account, then signs in', async () => {
    const { api, signInWithPassword } = renderSignedOut(<CreateAccountPage />);
    api.signUp.mockResolvedValue({ email: 'ravi.kumar@gmail.com', status: 'PENDING' });
    const select = await screen.findByLabelText('Canteen you work at');
    await screen.findByRole('option', { name: 'K&G Night Canteen (Night)' });
    fillForm();
    fireEvent.change(select, { target: { value: '20000000-0000-4000-8000-000000000002' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() =>
      expect(api.signUp).toHaveBeenCalledWith({
        name: 'Ravi Kumar',
        email: 'ravi.kumar@gmail.com',
        password: 'correct-horse-battery',
        requestedCanteenId: '20000000-0000-4000-8000-000000000002',
      }),
    );
    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith(
        'ravi.kumar@gmail.com',
        'correct-horse-battery',
      ),
    );
  });

  it('requires every field, including the canteen', async () => {
    renderSignedOut(<CreateAccountPage />);
    await screen.findByRole('option', { name: 'K&G Day Canteen (Day)' });
    fillForm();
    expect(screen.getByRole('button', { name: 'Request access' })).toBeDisabled();
  });

  it('checks the password and its confirmation before calling the backend', async () => {
    const { api } = renderSignedOut(<CreateAccountPage />);
    await screen.findByRole('option', { name: 'K&G Day Canteen (Day)' });
    fillForm({ 'Confirm password': 'something-else-1' });
    fireEvent.change(screen.getByLabelText('Canteen you work at'), {
      target: { value: '20000000-0000-4000-8000-000000000001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    fillForm({ Password: 'short', 'Confirm password': 'short' });
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(api.signUp).not.toHaveBeenCalled();
  });

  it('explains an address that is already registered', async () => {
    const { api, signInWithPassword } = renderSignedOut(<CreateAccountPage />);
    api.signUp.mockRejectedValue(
      new ApiError(409, 'EMAIL_IN_USE', 'This email is already registered.'),
    );
    await screen.findByRole('option', { name: 'K&G Day Canteen (Day)' });
    fillForm();
    fireEvent.change(screen.getByLabelText('Canteen you work at'), {
      target: { value: '20000000-0000-4000-8000-000000000001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This email is already registered.');
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('explains an unreachable backend and retries loading the canteens', async () => {
    const api = fakeStaffApi();
    api.serviceAreaDirectory
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValue(
        DIRECTORY as unknown as Awaited<ReturnType<StaffApi['serviceAreaDirectory']>>,
      );
    render(
      <ToastProvider>
        <FakeAuthProvider me={null}>
          <StaffApiContext.Provider value={api as unknown as StaffApi}>
            <MemoryRouter>
              <CreateAccountPage />
            </MemoryRouter>
          </StaffApiContext.Provider>
        </FakeAuthProvider>
      </ToastProvider>,
    );
    expect(await screen.findByText(/Could not load canteens\. Unable to connect/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading canteens' }));
    expect(
      await screen.findByRole('option', { name: 'K&G Night Canteen (Night)' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry loading canteens' }),
    ).not.toBeInTheDocument();
    expect(api.serviceAreaDirectory).toHaveBeenCalledTimes(2);
  });
});

describe('staff Account page: password change', () => {
  it('changes the password through the auth provider', async () => {
    const me = meStaff();
    const changePassword = vi.fn(async () => undefined);
    const api = fakeStaffApi();
    api.changeRequests.mockResolvedValue({ data: [], nextCursor: null } as unknown as Awaited<
      ReturnType<StaffApi['changeRequests']>
    >);
    render(
      <ToastProvider>
        <FakeAuthProvider me={me as Me} overrides={{ changePassword }}>
          <StaffCanteenProvider me={me}>
            <StaffApiContext.Provider value={api as unknown as StaffApi}>
              <FakeRealtimeProvider fake={createFakeSocket()} connectionEpoch={1}>
                <MemoryRouter>
                  <AccountPage me={me} />
                </MemoryRouter>
              </FakeRealtimeProvider>
            </StaffApiContext.Provider>
          </StaffCanteenProvider>
        </FakeAuthProvider>
      </ToastProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Password' })).toBeInTheDocument();
    type('Current password', 'old-password-1');
    type('New password', 'new-password-1');
    type('Confirm new password', 'new-password-1');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-password-1',
        newPassword: 'new-password-1',
      }),
    );
    expect(await screen.findByText(/^Password changed\./)).toBeInTheDocument();
  });
});
