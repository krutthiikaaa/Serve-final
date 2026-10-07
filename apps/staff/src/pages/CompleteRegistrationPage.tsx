import { useState, type FormEvent } from 'react';
import { AuthLayout, Button, Field, FormError, Input, useAuth } from '@serve/web-shared';
import { useStaffApi } from '../useStaffApi';
import { CanteenSelect } from '../components/CanteenSelect';

/** Step 2: create the PENDING staff account in SERVE and request a canteen. */
export function CompleteRegistrationPage() {
  const { user, refreshMe, signOut } = useAuth();
  const api = useStaffApi();
  const [name, setName] = useState(user?.displayName ?? '');
  const [canteenId, setCanteenId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.registerStaff({
        name: name.trim(),
        email: user?.email ?? '',
        ...(canteenId ? { requestedCanteenId: canteenId } : {}),
      });
      await refreshMe();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <AuthLayout subtitle="Your staff details">
      <section className="section">
        <form className="section-body form" onSubmit={(e) => void submit(e)} noValidate>
          <FormError error={error} />
          <Field label="Email">{(p) => <Input {...p} value={user?.email ?? ''} readOnly />}</Field>
          <Field label="Full name">
            {(p) => (
              <Input
                {...p}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            )}
          </Field>
          <CanteenSelect label="Canteen you work at" value={canteenId} onChange={setCanteenId} />
          <Button type="submit" loading={busy} disabled={!name.trim() || !canteenId}>
            Request access
          </Button>
        </form>
      </section>
      <Button variant="ghost" onClick={() => void signOut()}>
        Use a different account
      </Button>
    </AuthLayout>
  );
}
