import { NotificationCenter, useAuth } from '@serve/web-shared';

export function NotificationsPage() {
  const { api } = useAuth();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p>
            Staff access requests and reassignment requests. Paused canteens, missing schedules, and
            payment warnings are shown on the dashboard from live data. They are not stored as
            notifications.
          </p>
        </div>
      </div>
      <NotificationCenter api={api} />
    </>
  );
}
