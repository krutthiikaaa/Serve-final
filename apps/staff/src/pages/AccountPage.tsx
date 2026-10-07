import { useState, type FormEvent } from 'react';
import type { ChangeRequest, MeStaff } from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  IconInbox,
  SkeletonRows,
  Tag,
  TextArea,
  formatDateTime,
  useAuth,
  useResource,
  useServerEvent,
  useToast,
} from '@serve/web-shared';
import { useStaffApi } from '../useStaffApi';
import { CanteenSelect } from '../components/CanteenSelect';

/** Profile, assigned canteen and reassignment requests (an admin decides). */
export function AccountPage({ me }: { me: MeStaff }) {
  const api = useStaffApi();
  const { refreshMe } = useAuth();
  const history = useResource(() => api.changeRequests(), [api, me.pendingChangeRequest?.id]);

  useServerEvent('change_request.updated', () => {
    void history.reload();
    void refreshMe();
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Account</h1>
          <p>Your staff profile and canteen assignment.</p>
        </div>
      </div>

      <section className="section">
        <div className="section-header">
          <h2>Profile</h2>
        </div>
        <dl className="section-body detail-grid">
          <dt>Name</dt>
          <dd>{me.name}</dd>
          <dt>Email</dt>
          <dd>{me.email}</dd>
          <dt>Status</dt>
          <dd>
            <Tag tone="success">Approved</Tag>
          </dd>
          <dt>Assigned canteen</dt>
          <dd>{me.canteen?.name}</dd>
        </dl>
      </section>

      <section className="section">
        <div className="section-header">
          <h2>Request a different canteen</h2>
        </div>
        <div className="section-body">
          {me.pendingChangeRequest ? (
            <p>
              Your request to move to{' '}
              <strong>{me.pendingChangeRequest.requestedCanteen.name}</strong> is waiting for an
              admin (sent {formatDateTime(me.pendingChangeRequest.createdAt)}).
            </p>
          ) : (
            <ReassignmentForm
              currentCanteenId={me.canteen?.id ?? null}
              onSent={() => void refreshMe()}
            />
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <h2>Request history</h2>
        </div>
        {history.loading && !history.data ? (
          <SkeletonRows rows={2} />
        ) : history.error && !history.data ? (
          <ErrorState error={history.error} onRetry={() => void history.reload()} />
        ) : history.data && history.data.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Canteen</th>
                  <th>Status</th>
                  <th>Admin note</th>
                </tr>
              </thead>
              <tbody>
                {history.data.data.map((request) => (
                  <tr key={request.id}>
                    <td className="muted">{formatDateTime(request.createdAt)}</td>
                    <td>
                      {request.fromCanteen ? `${request.fromCanteen.name} → ` : ''}
                      {request.requestedCanteen.name}
                    </td>
                    <td>
                      <RequestStatusTag status={request.status} />
                    </td>
                    <td className="muted">{request.reviewNotes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<IconInbox />} title="No requests yet" />
        )}
      </section>
    </>
  );
}

export function RequestStatusTag({ status }: { status: ChangeRequest['status'] }) {
  if (status === 'APPROVED') return <Tag tone="success">Approved</Tag>;
  if (status === 'REJECTED') return <Tag tone="danger">Rejected</Tag>;
  return <Tag tone="warning">Pending</Tag>;
}

function ReassignmentForm({
  currentCanteenId,
  onSent,
}: {
  currentCanteenId: string | null;
  onSent: () => void;
}) {
  const api = useStaffApi();
  const toast = useToast();
  const [canteenId, setCanteenId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestAccess({
        requestedCanteenId: canteenId,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast('Request sent to the admins');
      onSent();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form narrow" onSubmit={(e) => void submit(e)}>
      <p className="muted">
        You keep working at your current canteen until an admin approves the move.
      </p>
      <FormError error={error} />
      <CanteenSelect
        value={canteenId}
        onChange={setCanteenId}
        exclude={currentCanteenId}
        label="New canteen"
      />
      <Field label="Reason (optional)">
        {(p) => (
          <TextArea
            {...p}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        )}
      </Field>
      <div>
        <Button type="submit" loading={busy} disabled={!canteenId}>
          Send request
        </Button>
      </div>
    </form>
  );
}
