import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Notification, NotificationPage } from '@serve/contracts';
import type { ApiClient } from './api';
import { timeAgo } from './format';
import { useRealtime, useServerEvent } from './realtime';
import { Button, EmptyState, ErrorState, SkeletonRows, useToast } from './ui/components';
import { IconBell, IconCheck } from './ui/icons';

export function notificationsApi(api: ApiClient) {
  return {
    async list(params: { cursor?: string; unread?: boolean } = {}): Promise<NotificationPage> {
      const res = await api.request<NotificationPage>('GET', '/notifications', {
        query: { limit: 20, cursor: params.cursor, unread: params.unread ? 'true' : undefined },
      });
      return res.body;
    },
    markRead: (id: string) => api.data<Notification>('PATCH', `/notifications/${id}/read`),
    markAllRead: () => api.data<{ updated: number }>('PATCH', '/notifications/read-all'),
  };
}

interface NotificationsContextValue {
  unreadCount: number;
  /** Most recent realtime notification (for toasts / list prepends). */
  latest: Notification | null;
  refresh: () => Promise<void>;
  setUnreadCount: (count: number) => void;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadCount: 0,
  latest: null,
  refresh: async () => undefined,
  setUnreadCount: () => undefined,
});

/** Keeps the unread badge in sync: REST on start/reconnect, realtime in between. */
export function NotificationsProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [latest, setLatest] = useState<Notification | null>(null);
  const { connectionEpoch } = useRealtime();
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const page = await notificationsApi(api).list({ unread: true });
      setUnreadCount(page.unreadCount);
    } catch {
      /* the badge is non-critical; the page shows errors */
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh, connectionEpoch]);

  useServerEvent('notification.created', ({ notification }) => {
    setLatest(notification);
    setUnreadCount((n) => n + 1);
    toast(notification.title, 'info');
  });

  return (
    <NotificationsContext.Provider value={{ unreadCount, latest, refresh, setUnreadCount }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);

/** Full notification center (list, mark read, mark all read, pagination). */
export function NotificationCenter({ api }: { api: ApiClient }) {
  const client = notificationsApi(api);
  const { latest, setUnreadCount } = useNotifications();
  const { connectionEpoch } = useRealtime();
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await notificationsApi(api).list();
      setItems(page.data);
      setCursor(page.nextCursor);
      setUnreadCount(page.unreadCount);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, setUnreadCount]);

  useEffect(() => {
    void load();
  }, [load, connectionEpoch]);

  useEffect(() => {
    if (latest)
      setItems((list) => (list.some((n) => n.id === latest.id) ? list : [latest, ...list]));
  }, [latest]);

  const markRead = async (notification: Notification) => {
    if (notification.readAt) return;
    const updated = await client.markRead(notification.id);
    setItems((list) => list.map((n) => (n.id === updated.id ? updated : n)));
    setUnreadCount(Math.max(0, items.filter((n) => !n.readAt).length - 1));
  };

  const markAll = async () => {
    await client.markAllRead();
    const now = new Date().toISOString();
    setItems((list) => list.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    setUnreadCount(0);
    toast('All notifications marked as read');
  };

  const more = async () => {
    if (!cursor) return;
    const page = await client.list({ cursor });
    setItems((list) => [...list, ...page.data]);
    setCursor(page.nextCursor);
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2>Notifications</h2>
        <Button
          variant="secondary"
          size="sm"
          icon={<IconCheck width={16} height={16} />}
          onClick={() => void markAll()}
          disabled={!items.some((n) => !n.readAt)}
        >
          Mark all read
        </Button>
      </div>
      {loading && items.length === 0 ? (
        <SkeletonRows />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconBell />}
          title="You're all caught up"
          body="New updates will appear here."
        />
      ) : (
        <ul className="notification-list">
          {items.map((n) => (
            <li key={n.id} className={n.readAt ? '' : 'unread'}>
              <button
                type="button"
                onClick={() => void markRead(n)}
                aria-label={`${n.title}${n.readAt ? '' : ' (unread)'}`}
              >
                <span className="notification-dot" aria-hidden />
                <span className="notification-text">
                  <strong>{n.title}</strong>
                  <span>{n.message}</span>
                </span>
                <span className="notification-time">{timeAgo(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <div className="section-body center">
          <Button variant="ghost" onClick={() => void more()}>
            Load more
          </Button>
        </div>
      ) : null}
    </section>
  );
}
