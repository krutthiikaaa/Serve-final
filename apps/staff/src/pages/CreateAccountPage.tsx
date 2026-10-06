import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AuthLayout,
  Button,
  Field,
  FormError,
  Input,
  firebaseErrorMessage,
  useAuth,
} from '@serve/web-shared';

/** Step 1 of staff onboarding: create the Firebase account. Step 2 (details + canteen) follows once signed in. */
export function CreateAccountPage() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signUp(email, password);
    } catch (err) {
      setError(firebaseErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout subtitle="Request staff access">
      <section className="section">
        <form className="section-body form" onSubmit={(e) => void submit(e)} noValidate>
          <p className="muted small">
            Create your sign-in. An admin approves your access before you can operate a canteen.
          </p>
          <FormError error={error} />
          <Field label="Work email">
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Password" hint="At least 6 characters">
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={busy} disabled={!email || password.length < 6}>
            Continue
          </Button>
        </form>
      </section>
      <p className="auth-switch">
        Already have access? <Link to="/">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
