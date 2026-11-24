import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ServiceAreaDirectory } from '@serve/contracts';
import {
  AuthLayout,
  Button,
  Field,
  FormError,
  Input,
  PASSWORD_MIN_LENGTH,
  Select,
  fieldErrors,
  newPasswordProblem,
  useAuth,
  useResource,
} from '@serve/web-shared';
import { useStaffApi } from '../useStaffApi';

const TYPE_LABEL = { DAY: 'Day', NIGHT: 'Night' } as const;

/**
 * Staff self-registration: name, email (any address, e.g. Gmail or Outlook),
 * password and the canteen they work at. The account is PENDING until an
 * admin approves it; the staff member is signed in straight away and sees
 * the awaiting-approval screen.
 */
export function CreateAccountPage() {
  const api = useStaffApi();
  const { signInWithPassword } = useAuth();
  const directory = useResource<ServiceAreaDirectory>(() => api.serviceAreaDirectory(), [api]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [canteenId, setCanteenId] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const problem = newPasswordProblem(password, confirmation);
  const serverErrors = fieldErrors(error);
  const complete = Boolean(name.trim() && email.trim() && password && confirmation && canteenId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!complete || problem) return;
    setBusy(true);
    setError(null);
    try {
      await api.signUp({
        name: name.trim(),
        email: email.trim(),
        password,
        requestedCanteenId: canteenId,
      });
    } catch (err) {
      setError(err);
      setBusy(false);
      return;
    }
    // The account exists (PENDING): sign in with it to see the approval status.
    if (!(await signInWithPassword(email, password))) setBusy(false);
  };

  return (
    <AuthLayout subtitle="Request staff access">
      <section className="section">
        <form className="section-body form" onSubmit={(e) => void submit(e)} noValidate>
          <p className="muted small">
            Create your staff login with any email address you use (personal Gmail or Outlook is
            fine). An admin approves your access before you can use the dashboard.
          </p>
          <FormError error={error} />
          <Field label="Full name" error={serverErrors.name}>
            {(p) => (
              <Input
                {...p}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            )}
          </Field>
          <Field label="Email" error={serverErrors.email}>
            {(p) => (
              <Input
                {...p}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
              />
            )}
          </Field>
          <Field
            label="Password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            error={serverErrors.password}
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            )}
          </Field>
          <Field label="Confirm password" error={touched ? (problem ?? undefined) : undefined}>
            {(p) => (
              <Input
                {...p}
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
              />
            )}
          </Field>
          <Field
            label="Canteen you work at"
            error={
              directory.error
                ? 'Could not load canteens'
                : (serverErrors.requestedCanteenId ?? undefined)
            }
          >
            {(p) => (
              <Select
                {...p}
                value={canteenId}
                onChange={(e) => setCanteenId(e.target.value)}
                disabled={directory.loading}
              >
                <option value="">{directory.loading ? 'Loading…' : 'Select a canteen'}</option>
                {(directory.data ?? []).map((area) => (
                  <optgroup key={area.id} label={area.name}>
                    {area.canteens.map((canteen) => (
                      <option key={canteen.id} value={canteen.id}>
                        {canteen.name} ({TYPE_LABEL[canteen.type]})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" loading={busy} disabled={!complete}>
            Request access
          </Button>
        </form>
      </section>
      <p className="auth-switch">
        Already have access? <Link to="/">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
