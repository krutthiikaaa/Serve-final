import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ORDER_EVENT_NAMES } from '@serve/contracts';
import {
  EmptyState,
  ErrorState,
  IconReceipt,
  SkeletonRows,
  StatusPill,
  formatRupees,
  formatTime,
  useRealtime,
  useResource,
  useServerEvents,
} from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';

/** Platform overview. Every figure is computed by the backend (`/api/admin/dashboard`). */
export function DashboardPage() {
  const api = useAdminApi();
  const { connectionEpoch } = useRealtime();
  const dashboard = useResource(() => api.dashboard(), [api, connectionEpoch]);
  const recent = useResource(() => api.orders({ limit: 10 }), [api, connectionEpoch]);

  useServerEvents(
    [
      ...ORDER_EVENT_NAMES,
      'change_request.created',
      'change_request.updated',
      'staff.approved',
      'staff.rejected',
      'staff.deactivated',
      'canteen.status_changed',
    ] as const,
    (name) => {
      void dashboard.reload();
      if (name.startsWith('order.')) void recent.reload();
    },
  );

  if (dashboard.error && !dashboard.data)
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.reload()} />;
  const d = dashboard.data;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>All night canteens, live.</p>
        </div>
      </div>

      {d ? (
        <>
          {d.pendingChangeRequests > 0 ? (
            <div className="notice notice-info" role="status">
              {d.pendingChangeRequests} staff{' '}
              {d.pendingChangeRequests === 1 ? 'request is' : 'requests are'} waiting for review.{' '}
              <Link to="/change-requests">Review now</Link>
            </div>
          ) : null}

          <section aria-labelledby="orders-heading" className="dashboard-group">
            <h2 id="orders-heading" className="group-title">
              Orders tonight
            </h2>
            <div className="stats">
              <Stat label="Active orders" value={d.orders.active} />
              <Stat
                label="Awaiting preparation"
                value={d.orders.awaitingPreparation}
                accent={d.orders.awaitingPreparation > 0}
              />
              <Stat label="Preparing" value={d.orders.preparing} />
              <Stat label="Ready for pickup" value={d.orders.ready} />
              <Stat label="Today's orders" value={d.today.orderCount} />
              <Stat label="Today's revenue" value={formatRupees(d.today.revenuePaise)} />
            </div>
          </section>

          <div className="dashboard-columns">
            <section aria-labelledby="canteens-heading" className="dashboard-group">
              <h2 id="canteens-heading" className="group-title">
                Canteens
              </h2>
              <div className="stats">
                <Stat label="Total" value={d.canteens.total} />
                <Stat label="Accepting orders" value={d.canteens.acceptingOrders} />
                <Stat label="Paused" value={d.canteens.paused} />
                <Stat label="Inactive" value={d.canteens.inactive} />
              </div>
            </section>
            <section aria-labelledby="staff-heading" className="dashboard-group">
              <h2 id="staff-heading" className="group-title">
                Staff
              </h2>
              <div className="stats">
                <Stat label="Active" value={d.staff.active} />
                <Stat label="Pending" value={d.staff.pending} accent={d.staff.pending > 0} />
                <Stat
                  label="Pending requests"
                  value={d.pendingChangeRequests}
                  accent={d.pendingChangeRequests > 0}
                />
                <Stat label="Deactivated" value={d.staff.deactivated} />
              </div>
            </section>
          </div>
        </>
      ) : (
        <SkeletonRows rows={3} />
      )}

      <section className="section">
        <div className="section-header">
          <h2>Latest orders</h2>
        </div>
        {recent.loading && !recent.data ? (
          <SkeletonRows />
        ) : recent.error && !recent.data ? (
          <ErrorState error={recent.error} onRetry={() => void recent.reload()} />
        ) : recent.data && recent.data.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Canteen</th>
                  <th>Student</th>
                  <th>Total</th>
                  <th>Placed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.data.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong className="order-number">{order.orderNumber}</strong>
                    </td>
                    <td>{order.canteen.name}</td>
                    <td>{order.student.name}</td>
                    <td className="num">{formatRupees(order.totalPaise)}</td>
                    <td className="muted">{formatTime(order.createdAt)}</td>
                    <td>
                      <StatusPill status={order.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<IconReceipt />}
            title="No orders yet"
            body="Orders from every canteen appear here as students place them."
          />
        )}
      </section>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className={`stat${accent ? ' stat-accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
