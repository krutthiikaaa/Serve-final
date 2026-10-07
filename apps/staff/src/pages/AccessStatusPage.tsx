import { useState, type FormEvent } from 'react';
import type { MeStaff } from '@serve/contracts';
import {
  AuthLayout,
  Button,
  FormError,
  IconClock,
  IconX,
  TextArea,
  Field,
  formatDateTime,
  useAuth,
  useServerEvent,
  useToast,
} from '@serve/web-shared';
import { useStaffApi } from '../useStaffApi';
import { CanteenSelect } from '../components/CanteenSelect';

/** Pending / rejected / deactivated staff: no operational access until an admin approves. */
export function AccessStatusPage({ me }: { me: MeStaff }) {
  const { refreshMe, signOut } = useAuth();
  const toast = useToast();

  // The server moves this socket into the canteen room on approval; we only refresh /me.
  useServerEvent('staff.approved', () => {
    toast('Your access was approved');
    void refreshMe();
  });
  useServerEvent('staff.canteen_assigned', () => void refreshMe());
  useServerEvent('staff.rejected', () => void refreshMe());
  useServerEvent('staff.deactivated', () => void refreshMe());

  if (me.status === 'DEACTIVATED') {
    return (
      <AuthLayout subtitle="Access removed">
        <section className="section">
          <div className="section-body status-panel">
            <span className="status-icon danger">
              <IconX />
            </span>
            <p>
              Your staff access has been deactivated by an admin. Contact your SERVE administrator
              if this is unexpected.
            </p>
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </section>
      </AuthLayout>
    );
  }

  const pending = me.pendingChangeRequest;
  return (
    <AuthLayout
      subtitle={
        pending
          ? 'Awaiting approval'
          : me.status === 'REJECTED'
            ? 'Request not approved'
            : 'Request canteen access'
      }
    >
      <section className="section">
        <div className="section-body status-panel">
          {pending ? (
            <>
              <span className="status-icon">
                <IconClock />
              </span>
              <p>
                Your request for <strong>{pending.requestedCanteen.name}</strong> was sent{' '}
                {formatDateTime(pending.createdAt)}. This page updates automatically when an admin
                reviews it.
              </p>
            </>
          ) : (
            <RequestAccessForm
              rejected={me.status === 'REJECTED'}
              onDone={() => void refreshMe()}
            />
          )}
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </section>
    </AuthLayout>
  );
}

function RequestAccessForm({ rejected, onDone }: { rejected: boolean; onDone: () => void }) {
  const api = useStaffApi();
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
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      {rejected ? (
        <p className="muted">
          Your previous request was not approved. You can request access again.
        </p>
      ) : null}
      <FormError error={error} />
      <CanteenSelect value={canteenId} onChange={setCanteenId} />
      <Field label="Note for the admin (optional)">
        {(p) => <TextArea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      <Button type="submit" loading={busy} disabled={!canteenId}>
        Send request
      </Button>
    </form>
  );
}

export function WrongPortalPage({ role }: { role: 'STUDENT' | 'ADMIN' }) {
  const { signOut } = useAuth();
  return (
    <AuthLayout subtitle="This is the staff dashboard">
      <section className="section">
        <div className="section-body status-panel">
          <p>
            You are signed in with a {role === 'ADMIN' ? 'SERVE admin' : 'student'} account.{' '}
            {role === 'ADMIN'
              ? 'Use the admin portal instead.'
              : 'Use the SERVE mobile app to order.'}
          </p>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </section>
    </AuthLayout>
  );
}
