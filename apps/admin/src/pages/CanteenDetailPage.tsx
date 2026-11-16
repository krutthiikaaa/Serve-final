import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AvailabilityTag,
  Button,
  CanteenTypeBadge,
  EmptyState,
  ErrorState,
  IconEdit,
  KpiStrip,
  SkeletonRows,
  Tag,
  errorMessage,
  useRealtime,
  useResource,
  useServerEvent,
  useToast,
} from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';
import { ConfigurationWarnings } from '../components/ConfigurationWarnings';
import { CanteenFormModal, CanteenStatus } from './CanteensPage';
import { MenuPricingSection } from './canteen/MenuPricingSection';
import { PaymentSection } from './canteen/PaymentSection';
import { QrSection } from './canteen/QrSection';
import { ServicesHoursSection } from './canteen/ServicesHoursSection';
import { StaffStatusTag } from './StaffPage';

export function CanteenDetailPage() {
  const { id = '' } = useParams();
  const api = useAdminApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const canteen = useResource(() => api.canteen(id), [api, id, connectionEpoch]);
  const live = useResource(() => api.liveCanteen(id), [api, id, connectionEpoch]);
  const areas = useResource(() => api.serviceAreas(), [api, connectionEpoch]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useServerEvent('canteen.status_changed', (data) => {
    if (data.canteenId === id) {
      void canteen.reload();
      void live.reload();
    }
  });

  const toggle = async (patch: { isActive?: boolean; isPaused?: boolean }, message: string) => {
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
          <p className="title-meta">
            <CanteenTypeBadge type={c.type} />
            <span>{c.serviceArea.name}</span>
            <span className="muted">
              {[c.location, c.openingHours].filter(Boolean).join(' · ') ||
                'No location or hours set'}
            </span>
          </p>
        </div>
        <div className="header-actions">
          {live.data ? (
            <AvailabilityTag state={live.data.availability.state} />
          ) : (
            <CanteenStatus canteen={c} />
          )}
          <Button
            variant="secondary"
            icon={<IconEdit width={16} height={16} />}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          {c.isActive ? (
            <>
              {/* Pause is separate from being on duty (which the area's schedule or
                  switch decides on the Canteens page); the schedule never lifts it. */}
              {c.isPaused || c.isAcceptingOrders ? (
                <Button
                  variant="secondary"
                  loading={busy}
                  onClick={() =>
                    void toggle(
                      { isPaused: !c.isPaused },
                      c.isPaused ? 'Pause lifted' : 'Order-taking paused',
                    )
                  }
                >
                  {c.isPaused ? 'Resume orders' : 'Pause orders'}
                </Button>
              ) : null}
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

      <ConfigurationWarnings warnings={c.configurationWarnings} />

      <KpiStrip
        label="Menu and coverage"
        items={[
          { label: 'Menu categories', value: c.menuSummary.categories },
          { label: 'Menu items', value: c.menuSummary.items },
          { label: 'Available now', value: c.menuSummary.availableItems },
          { label: 'Hostels served', value: c.hostels.length },
        ]}
      />

      <ServicesHoursSection
        canteenId={id}
        detail={c}
        live={live.data}
        onUpdated={async () => {
          await Promise.all([canteen.reload(), live.reload()]);
        }}
      />

      <div className="dashboard-columns">
        <section className="section">
          <div className="section-header">
            <h2>Hostels in {c.serviceArea.name}</h2>
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
            <h2>Staff account</h2>
            <Link to="/staff" className="btn btn-ghost btn-sm">
              Manage accounts
            </Link>
          </div>
          {c.staff.filter((s) => s.status === 'APPROVED').length === 0 ? (
            <EmptyState
              title="No staff account assigned"
              body="Each canteen has one dedicated staff login. Assign it from the Staff page."
            />
          ) : (
            <ul className="plain-list">
              {c.staff
                .filter((s) => s.status === 'APPROVED')
                .map((s) => (
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

      <MenuPricingSection canteenId={id} canteenType={c.type} />

      <QrSection canteenId={id} canteenName={c.name} />

      <PaymentSection canteenId={id} />

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
          areas={areas.data ?? []}
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
