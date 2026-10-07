import { Link, Outlet } from 'react-router-dom';
import type { MeAdmin } from '@serve/contracts';
import {
  ConnectionBanner,
  IconBell,
  IconGrid,
  IconInbox,
  IconStore,
  IconUsers,
  Shell,
  useAuth,
  useNotifications,
  useRealtime,
  useResource,
  useServerEvents,
} from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';

/** Admin shell. The pending-request badge is read from the backend dashboard, refreshed by events. */
export function AdminLayout({ me }: { me: MeAdmin }) {
  const api = useAdminApi();
  const { signOut } = useAuth();
  const { state, connectionEpoch } = useRealtime();
  const { unreadCount } = useNotifications();
  const summary = useResource(() => api.dashboard(), [api, connectionEpoch]);
  useServerEvents(
    [
      'change_request.created',
      'change_request.updated',
      'staff.deactivated',
      'staff.canteen_assigned',
    ] as const,
    () => {
      void summary.reload();
    },
  );
  const pending = summary.data?.pendingChangeRequests ?? 0;

  return (
    <Shell
      product="Admin portal"
      context={
        <>
          <small>Signed in as</small>
          Platform admin
        </>
      }
      nav={[
        { to: '/', label: 'Dashboard', icon: <IconGrid /> },
        { to: '/canteens', label: 'Canteens', icon: <IconStore /> },
        { to: '/change-requests', label: 'Change requests', icon: <IconInbox />, count: pending },
        { to: '/staff', label: 'Staff', icon: <IconUsers /> },
        { to: '/notifications', label: 'Notifications', icon: <IconBell />, count: unreadCount },
      ]}
      onSignOut={() => void signOut()}
      banner={<ConnectionBanner state={state} />}
      topbar={
        <>
          <div className="topbar-title">
            <strong>SERVE administration</strong>
          </div>
          <div className="topbar-actions">
            <Link
              to="/notifications"
              className="icon-button"
              aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            >
              <IconBell />
              {unreadCount ? (
                <span className="badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              ) : null}
            </Link>
            <span className="topbar-user">
              <span className="avatar" aria-hidden>
                {me.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="topbar-user-name">{me.name}</span>
            </span>
          </div>
        </>
      }
    >
      <Outlet />
    </Shell>
  );
}
