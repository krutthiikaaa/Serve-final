import { NotificationCenter, useAuth } from '@serve/web-shared';

export function NotificationsPage() {
  const { api } = useAuth();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p>New staff requests and other platform updates.</p>
        </div>
      </div>
      <NotificationCenter api={api} />
    </>
  );
}
