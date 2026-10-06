import { NotificationCenter, useAuth } from '@serve/web-shared';

export function NotificationsPage() {
  const { api } = useAuth();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p>Access decisions, assignment changes and other updates for your account.</p>
        </div>
      </div>
      <NotificationCenter api={api} />
    </>
  );
}
