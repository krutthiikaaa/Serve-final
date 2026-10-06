import { useCallback, useEffect, useState } from 'react';
import type { ChangeRequest } from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  IconCheck,
  IconInbox,
  IconX,
  Modal,
  SkeletonRows,
  Tag,
  TextArea,
  formatDateTime,
  useRealtime,
  useServerEvent,
  useToast,
} from '@serve/web-shared';
import type { ChangeRequestStatus } from '../api/admin';
import { useAdminApi } from '../useAdminApi';

const TABS: { value: ChangeRequestStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

export function RequestStatusTag({ status }: { status: ChangeRequestStatus }) {
  if (status === 'APPROVED') return <Tag tone="success">Approved</Tag>;
  if (status === 'REJECTED') return <Tag tone="danger">Rejected</Tag>;
  return <Tag tone="warning">Pending</Tag>;
}

/** Staff access and reassignment requests. Approving assigns the staff member to the requested canteen. */
export function ChangeRequestsPage() {
  const api = useAdminApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const [tab, setTab] = useState<ChangeRequestStatus>('PENDING');
  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState<{
    request: ChangeRequest;
    decision: 'APPROVED' | 'REJECTED';
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.changeRequests(tab);
      setItems(page.data);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, tab]);

  useEffect(() => {
    void load();
  }, [load, connectionEpoch]);

  useServerEvent('change_request.created', ({ changeRequest }) => {
    if (tab === 'PENDING')
      setItems((list) =>
        list.some((r) => r.id === changeRequest.id) ? list : [changeRequest, ...list],
      );
    toast(`New request from ${changeRequest.staff.name}`, 'info');
  });
  useServerEvent('change_request.updated', ({ changeRequest }) => {
    // Another admin may have reviewed it: move it out of this tab or update it in place.
    setItems((list) =>
      changeRequest.status === tab
        ? list.some((r) => r.id === changeRequest.id)
          ? list.map((r) => (r.id === changeRequest.id ? changeRequest : r))
          : [changeRequest, ...list]
        : list.filter((r) => r.id !== changeRequest.id),
    );
  });

  const more = async () => {
    if (!cursor) return;
    try {
      const page = await api.changeRequests(tab, cursor);
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
          <h1>Change requests</h1>
          <p>New staff asking for access and existing staff asking to move canteens.</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Request status">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              className={tab === t.value ? 'active' : ''}
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <section className="section">
        {loading && items.length === 0 ? (
          <SkeletonRows />
        ) : error && items.length === 0 ? (
          <ErrorState error={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<IconInbox />}
            title={tab === 'PENDING' ? 'No pending requests' : `No ${tab.toLowerCase()} requests`}
            body={tab === 'PENDING' ? 'New requests appear here instantly.' : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Staff member</th>
                  <th>Request</th>
                  <th>Note</th>
                  <th>{tab === 'PENDING' ? 'Received' : 'Reviewed'}</th>
                  <th>{tab === 'PENDING' ? <span className="sr-only">Actions</span> : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="item-name">{r.staff.name}</div>
                      <div className="muted small">{r.staff.email}</div>
                    </td>
                    <td>
                      {r.fromCanteen ? (
                        <>
                          <span className="muted">Move from</span> {r.fromCanteen.name}{' '}
                          <span className="muted">to</span>{' '}
                          <strong>{r.requestedCanteen.name}</strong>
                        </>
                      ) : (
                        <>
                          <span className="muted">Access to</span>{' '}
                          <strong>{r.requestedCanteen.name}</strong>
                        </>
                      )}
                    </td>
                    <td className="muted">{r.notes ?? '—'}</td>
                    <td className="muted">
                      {formatDateTime(r.reviewedAt ?? r.createdAt)}
                      {r.reviewedBy ? <div className="small">by {r.reviewedBy.name}</div> : null}
                    </td>
                    <td>
                      {r.status === 'PENDING' ? (
                        <div className="row-actions">
                          <Button
                            size="sm"
                            variant="danger"
                            icon={<IconX width={14} height={14} />}
                            onClick={() => setReview({ request: r, decision: 'REJECTED' })}
                            aria-label={`Reject ${r.staff.name}`}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            icon={<IconCheck width={14} height={14} />}
                            onClick={() => setReview({ request: r, decision: 'APPROVED' })}
                            aria-label={`Approve ${r.staff.name}`}
                          >
                            Approve
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <RequestStatusTag status={r.status} />
                          {r.reviewNotes ? (
                            <div className="muted small">{r.reviewNotes}</div>
                          ) : null}
                        </div>
                      )}
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

      {review ? (
        <ReviewModal
          request={review.request}
          decision={review.decision}
          onClose={() => setReview(null)}
          onDone={(updated) => {
            setReview(null);
            setItems((list) => list.filter((r) => r.id !== updated.id));
            toast(
              updated.status === 'APPROVED'
                ? `${updated.staff.name} assigned to ${updated.requestedCanteen.name}`
                : `Request from ${updated.staff.name} rejected`,
            );
          }}
        />
      ) : null}
    </>
  );
}

export function ReviewModal({
  request,
  decision,
  onClose,
  onDone,
}: {
  request: ChangeRequest;
  decision: 'APPROVED' | 'REJECTED';
  onClose: () => void;
  onDone: (updated: ChangeRequest) => void;
}) {
  const api = useAdminApi();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const approve = decision === 'APPROVED';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = notes.trim() || undefined;
      onDone(
        approve
          ? await api.approveRequest(request.id, trimmed)
          : await api.rejectRequest(request.id, trimmed),
      );
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={approve ? `Approve ${request.staff.name}?` : `Reject ${request.staff.name}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={approve ? 'primary' : 'danger'}
            loading={busy}
            onClick={() => void submit()}
          >
            {approve ? 'Approve and assign' : 'Reject request'}
          </Button>
        </>
      }
    >
      <div className="form">
        <FormError error={error} />
        <p>
          {approve
            ? `${request.staff.name} will be assigned to ${request.requestedCanteen.name} and can start managing its orders immediately.`
            : `${request.staff.name} will be told the request for ${request.requestedCanteen.name} was not approved.`}
        </p>
        <Field label="Note to the staff member (optional)">
          {(p) => (
            <TextArea
              {...p}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
