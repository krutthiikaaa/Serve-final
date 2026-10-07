import { useState, type FormEvent, type ReactNode } from 'react';
import { firebaseErrorMessage } from './firebase';
import { Button, Field, FormError, Input, Logo } from './ui/components';

export function AuthLayout({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={56} />
          <p className="tagline">Order. Track. Collect.</p>
          <h1>{subtitle}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Email/password sign-in against Firebase Authentication. */
export function SignInForm({
  onSubmit,
  submitLabel = 'Sign in',
}: {
  onSubmit: (email: string, password: string) => Promise<void>;
  submitLabel?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email, password);
    } catch (err) {
      setError(firebaseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={(e) => void submit(e)} noValidate>
      <FormError error={error} />
      <Field label="Email">
        {(props) => (
          <Input
            {...props}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        )}
      </Field>
      <Field label="Password">
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        )}
      </Field>
      <Button type="submit" loading={busy} disabled={!email || !password}>
        {submitLabel}
      </Button>
    </form>
  );
}
