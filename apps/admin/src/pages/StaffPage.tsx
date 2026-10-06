import { useCallback, useEffect, useState } from 'react';
import type { StaffDetail, StaffStatus, StaffSummary } from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  IconUsers,
  Modal,
  Select,
  SkeletonRows,
  Tag,
  formatDateTime,
  useRealtime,
  useResource,
  useServerEvents,
  useToast,
} from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';
import { RequestStatusTag } from './ChangeRequestsPage';

const STATUS_FILTERS: { value: StaffStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
];

export function StaffStatusTag({ status }: { status: StaffStatus }) {
  switch (status) {
    case 'APPROVED':
      return <Tag tone="success">Approved</Tag>;
    case 'PENDING':
      return <Tag tone="warning">Pending</Tag>;
    case 'REJECTED':
      return <Tag tone="danger">Rejected</Tag>;
    default:
      return <Tag tone="neutral">Deactivated</Tag>;
  }
}

const STAFF_EVENTS = [
  'staff.approved',
  'staff.rejected',
  'staff.canteen_assigned',
  'staff.deactivated',
  'change_request.created',
  'change_request.updated',
] as const;

/** Staff directory with approval, (re)assignment and deactivation. */
export function StaffPage() {
  const api = useAdminApi();
  const { connectionEpoch } = useRealtime();
  const [status, setStatus] = useState<StaffStatus | 'ALL'>('ALL');
  const [canteenId, setCanteenId] = useState('');
  const [items, setItems] = useState<StaffSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const canteens = useResource(() => api.canteens(), [api]);

  const filters = useCallback(
    () => ({ status: status === 'ALL' ? undefined : status, canteenId: canteenId || undefined }),
    [status, canteenId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.staff(filters());
      setItems(page.data);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, filters]);

  useEffect(() => {
    void load();
  }, [load, connectionEpoch]);

  useServerEvents(STAFF_EVENTS, () => void load());

  const more = async () => {
    if (!cursor) return;
    try {
      const page = await api.staff({ ...filters(), cursor });
      setItems((list) => [...list, ...page.data]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Staff</h1>
          <p>Approve new staff, move them between canteens, or remove access.</p>
        </div>
      </div>

      <div className="filters">
        <div className="segmented" role="tablist" aria-label="Staff status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={status === f.value}
              className={status === f.value ? 'active' : ''}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="inline-select">
          <span>Canteen</span>
          <Select
            value={canteenId}
            onChange={(e) => setCanteenId(e.target.value)}
            aria-label="Filter by canteen"
          >
            <option value="">All canteens</option>
            {(canteens.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <section className="section">
        {loading && items.length === 0 ? (
          <SkeletonRows />
        ) : error && items.length === 0 ? (
          <ErrorState error={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<IconUsers />} title="No staff match these filters" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Canteen</th>
                  <th>Joined</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setSelected(s.id)}>
                    <td>
                      <div className="item-name">{s.name}</div>
                      <div className="muted small">{s.email}</div>
                    </td>
                    <td>
                      <StaffStatusTag status={s.status} />
                    </td>
                    <td>{s.canteen?.name ?? <span className="muted">—</span>}</td>
                    <td className="muted">{formatDateTime(s.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(s.id);
                          }}
                          aria-label={`Manage ${s.name}`}
                        >
                          Manage
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor ? (
          <div className="section-body center">
            <Button variant="ghost" onClick={() => void more()}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>

      {selected ? (
        <StaffDetailModal
          staffId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </>
  );
}

function StaffDetailModal({
  staffId,
  onClose,
  onChanged,
}: {
  staffId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const api = useAdminApi();
  const toast = useToast();
  const detail = useResource(() => api.staffMember(staffId), [api, staffId]);
  const canteens = useResource(() => api.canteens(), [api]);
  const [canteenId, setCanteenId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useServerEvents(STAFF_EVENTS, () => void detail.reload());

  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      toast(message);
      await detail.reload();
      onChanged();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const s: StaffDetail | undefined = detail.data;
  const pending = s?.changeRequests.find((r) => r.status === 'PENDING');
  const assignable = (canteens.data ?? []).filter((c) => c.isActive && c.id !== s?.canteen?.id);
  const assignLabel = !s
    ? 'Assign'
    : s.status === 'APPROVED'
      ? 'Reassign'
      : s.status === 'DEACTIVATED'
        ? 'Reactivate and assign'
        : 'Approve and assign';

  return (
    <Modal title={s ? s.name : 'Staff member'} onClose={onClose}>
      {detail.loading && !s ? (
        <SkeletonRows rows={3} />
      ) : detail.error && !s ? (
        <ErrorState error={detail.error} onRetry={() => void detail.reload()} />
      ) : s ? (
        <div className="form">
          <FormError error={error} />
          <dl className="detail-grid">
            <dt>Email</dt>
            <dd>{s.email}</dd>
            <dt>Status</dt>
            <dd>
              <StaffStatusTag status={s.status} />
            </dd>
            <dt>Canteen</dt>
            <dd>{s.canteen?.name ?? '—'}</dd>
            <dt>Joined</dt>
            <dd>{formatDateTime(s.createdAt)}</dd>
          </dl>

          {pending ? (
            <div className="callout">
              <p>
                <strong>Pending request:</strong>{' '}
                {pending.fromCanteen ? `move from ${pending.fromCanteen.name} to ` : 'access to '}
                <strong>{pending.requestedCanteen.name}</strong>
                {pending.notes ? <span className="muted"> — “{pending.notes}”</span> : null}
              </p>
              <div className="row-actions start">
                <Button
                  size="sm"
                  loading={busy === 'approve'}
                  disabled={!!busy}
                  onClick={() =>
                    void run(
                      'approve',
                      () => api.approveRequest(pending.id),
                      `${s.name} assigned to ${pending.requestedCanteen.name}`,
                    )
                  }
                >
                  Approve request
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === 'reject'}
                  disabled={!!busy}
                  onClick={() =>
                    void run(
                      'reject',
                      () => api.rejectRequest(pending.id),
                      `Request from ${s.name} rejected`,
                    )
                  }
                >
                  Reject request
                </Button>
              </div>
            </div>
          ) : null}

          <div className="assign-row">
            <Field label={s.status === 'APPROVED' ? 'Move to canteen' : 'Assign to canteen'}>
              {(p) => (
                <Select {...p} value={canteenId} onChange={(e) => setCanteenId(e.target.value)}>
                  <option value="">Select an active canteen</option>
                  {assignable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              loading={busy === 'assign'}
              disabled={!canteenId || !!busy}
              onClick={async () => {
                const target = assignable.find((c) => c.id === canteenId);
                if (
                  await run(
                    'assign',
                    () => api.assignStaff(s.id, canteenId),
                    `${s.name} assigned to ${target?.name ?? 'canteen'}`,
                  )
                )
                  setCanteenId('');
              }}
            >
              {assignLabel}
            </Button>
          </div>

          {s.changeRequests.length > 0 ? (
            <div>
              <h3 className="subheading">Request history</h3>
              <ul className="plain-list">
                {s.changeRequests.map((r) => (
                  <li key={r.id}>
                    <span>
                      {r.requestedCanteen.name}{' '}
                      <span className="muted small">{formatDateTime(r.createdAt)}</span>
                      {r.reviewNotes ? (
                        <span className="muted small"> · {r.reviewNotes}</span>
                      ) : null}
                    </span>
                    <RequestStatusTag status={r.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {s.status !== 'DEACTIVATED' ? (
            <div className="danger-zone">
              {confirmDeactivate ? (
                <>
                  <p>
                    Deactivating removes {s.name}'s access immediately and disconnects any open
                    dashboard. Pending requests are rejected.
                  </p>
                  <div className="row-actions start">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setConfirmDeactivate(false)}
                      disabled={!!busy}
                    >
                      Keep access
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy === 'deactivate'}
                      onClick={() =>
                        void run(
                          'deactivate',
                          () => api.deactivateStaff(s.id),
                          `${s.name} deactivated`,
                        ).then(() => setConfirmDeactivate(false))
                      }
                    >
                      Confirm deactivation
                    </Button>
                  </div>
                </>
              ) : (
                <Button size="sm" variant="danger" onClick={() => setConfirmDeactivate(true)}>
                  Deactivate staff member
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
