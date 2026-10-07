import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Notification } from '@serve/contracts';
import { ApiClient } from '../src/api';
import { NotificationCenter, NotificationsProvider, useNotifications } from '../src/notifications';
import { ToastProvider } from '../src/ui/components';
import { FakeRealtimeProvider, createFakeSocket } from '../src/testing';

const note = (id: string, readAt: string | null = null): Notification => ({
  id,
  type: 'STAFF_APPROVED',
  title: `Title ${id}`,
  message: `Message ${id}`,
  orderId: null,
  data: {},
  readAt,
  createdAt: '2026-10-06T19:00:00.000Z',
});

function fakeApi(handler: (method: string, url: URL) => unknown) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    return new Response(JSON.stringify(handler(init?.method ?? 'GET', url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return {
    api: new ApiClient({ baseUrl: 'http://localhost:5001', getToken: async () => 't', fetchImpl }),
    fetchImpl,
  };
}

function Badge() {
  const { unreadCount } = useNotifications();
  return <span data-testid="badge">{unreadCount}</span>;
}

describe('notifications', () => {
  it('loads the unread count and increments it on notification.created', async () => {
    const fake = createFakeSocket();
    const { api } = fakeApi(() => ({ data: [note('a')], nextCursor: null, unreadCount: 3 }));
    render(
      <ToastProvider>
        <FakeRealtimeProvider fake={fake}>
          <NotificationsProvider api={api}>
            <Badge />
          </NotificationsProvider>
        </FakeRealtimeProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('3'));
    act(() => fake.serverEmit('notification.created', { notification: note('b') }));
    expect(screen.getByTestId('badge')).toHaveTextContent('4');
    expect(screen.getByText('Title b')).toBeInTheDocument(); // toast
  });

  it('lists notifications, marks one read and marks all read', async () => {
    const fake = createFakeSocket();
    const { api, fetchImpl } = fakeApi((_method, url) => {
      if (url.pathname.endsWith('/read-all')) return { data: { updated: 2 } };
      if (url.pathname.endsWith('/read')) return { data: note('a', '2026-10-06T19:05:00.000Z') };
      return { data: [note('a'), note('b')], nextCursor: null, unreadCount: 2 };
    });
    render(
      <ToastProvider>
        <FakeRealtimeProvider fake={fake}>
          <NotificationsProvider api={api}>
            <Badge />
            <NotificationCenter api={api} />
          </NotificationsProvider>
        </FakeRealtimeProvider>
      </ToastProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Title a (unread)' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Title a' })).toBeInTheDocument(),
    );
    expect(
      fetchImpl.mock.calls.some(
        ([u, i]) => String(u).endsWith('/notifications/a/read') && i?.method === 'PATCH',
      ),
    ).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('0'));
    expect(screen.getByRole('button', { name: 'Title b' })).toBeInTheDocument();
  });

  it("shows an empty state when there's nothing", async () => {
    const { api } = fakeApi(() => ({ data: [], nextCursor: null, unreadCount: 0 }));
    render(
      <ToastProvider>
        <FakeRealtimeProvider fake={createFakeSocket()}>
          <NotificationsProvider api={api}>
            <NotificationCenter api={api} />
          </NotificationsProvider>
        </FakeRealtimeProvider>
      </ToastProvider>,
    );
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });
});
