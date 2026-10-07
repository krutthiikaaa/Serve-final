import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Button,
  EmptyState,
  ErrorState,
  IconEdit,
  SkeletonRows,
  Tag,
  errorMessage,
  useRealtime,
  useResource,
  useServerEvent,
  useToast,
} from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';
import { CanteenFormModal, CanteenStatus } from './CanteensPage';
import { StaffStatusTag } from './StaffPage';

export function CanteenDetailPage() {
  const { id = '' } = useParams();
  const api = useAdminApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const canteen = useResource(() => api.canteen(id), [api, id, connectionEpoch]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useServerEvent('canteen.status_changed', (data) => {
    if (data.canteenId === id) void canteen.reload();
  });

  const toggle = async (
    patch: { isActive?: boolean; isAcceptingOrders?: boolean },
    message: string,
  ) => {
    setBusy(true);
    try {
      await api.updateCanteen(id, patch);
      await canteen.reload();
      toast(message);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (canteen.loading && !canteen.data) return <SkeletonRows rows={6} />;
  if (canteen.error && !canteen.data)
    return <ErrorState error={canteen.error} onRetry={() => void canteen.reload()} />;
  const c = canteen.data!;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="breadcrumb">
            <Link to="/canteens">Canteens</Link> /
          </p>
          <h1>{c.name}</h1>
          <p>
            {[c.location, c.openingHours].filter(Boolean).join(' · ') || 'No location or hours set'}
          </p>
        </div>
        <div className="header-actions">
          <CanteenStatus canteen={c} />
          <Button
            variant="secondary"
            icon={<IconEdit width={16} height={16} />}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          {c.isActive ? (
            <>
              <Button
                variant="secondary"
                loading={busy}
                onClick={() =>
                  void toggle(
                    { isAcceptingOrders: !c.isAcceptingOrders },
                    c.isAcceptingOrders ? 'Order-taking paused' : 'Accepting orders',
                  )
                }
              >
                {c.isAcceptingOrders ? 'Pause orders' : 'Resume orders'}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void toggle({ isActive: false }, `${c.name} deactivated`)}
              >
                Deactivate
              </Button>
            </>
          ) : (
            <Button
              loading={busy}
              onClick={() => void toggle({ isActive: true }, `${c.name} activated`)}
            >
              Activate
            </Button>
          )}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Menu categories</div>
          <div className="stat-value">{c.menuSummary.categories}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Menu items</div>
          <div className="stat-value">{c.menuSummary.items}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Available now</div>
          <div className="stat-value">{c.menuSummary.availableItems}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Hostels served</div>
          <div className="stat-value">{c.hostels.length}</div>
        </div>
      </div>

      <div className="dashboard-columns">
        <section className="section">
          <div className="section-header">
            <h2>Hostels</h2>
          </div>
          {c.hostels.length === 0 ? (
            <EmptyState title="No hostels mapped" />
          ) : (
            <ul className="plain-list">
              {c.hostels.map((h) => (
                <li key={h.id}>
                  {h.name} {h.isActive ? null : <Tag tone="neutral">Inactive</Tag>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="section">
          <div className="section-header">
            <h2>Staff</h2>
            <Link to="/staff" className="btn btn-ghost btn-sm">
              Manage staff
            </Link>
          </div>
          {c.staff.length === 0 ? (
            <EmptyState
              title="No staff assigned"
              body="Approve a staff request or assign staff from the Staff page."
            />
          ) : (
            <ul className="plain-list">
              {c.staff.map((s) => (
                <li key={s.id}>
                  <span>
                    <strong>{s.name}</strong> <span className="muted small">{s.email}</span>
                  </span>
                  <StaffStatusTag status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="section">
        <div className="section-header">
          <h2>Menu by category</h2>
        </div>
        {c.menuSummary.byCategory.length === 0 ? (
          <EmptyState
            title="No menu yet"
            body="Staff assigned to this canteen can build the menu from their dashboard."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Items</th>
                  <th>Available</th>
                  <th>Visibility</th>
                </tr>
              </thead>
              <tbody>
                {c.menuSummary.byCategory.map((cat) => (
                  <tr key={cat.id}>
                    <td className="item-name">{cat.name}</td>
                    <td className="num">{cat.items}</td>
                    <td className="num">{cat.availableItems}</td>
                    <td>
                      {cat.isActive ? (
                        <Tag tone="success">Visible</Tag>
                      ) : (
                        <Tag tone="neutral">Hidden</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing ? (
        <CanteenFormModal
          canteen={c}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            void canteen.reload();
            toast(`${saved.name} updated`);
          }}
        />
      ) : null}
    </>
  );
}
