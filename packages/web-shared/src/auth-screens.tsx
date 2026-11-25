import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Field, FormError, Input, Logo, SERVE_TAGLINE } from './ui/components';
import type { PasswordChange } from './auth';

/** Password rules enforced by the backend (staff and admin accounts). */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export function AuthLayout({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={96} stacked />
          <p className="tagline">{SERVE_TAGLINE}</p>
          <h1>{subtitle}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Problems with a new password (and its confirmation), or null when it is acceptable. */
export function newPasswordProblem(password: string, confirmation: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (password !== confirmation) return 'The passwords do not match.';
  return null;
}

/**
 * Email + password sign-in (staff dashboard and admin portal). There is no
 * Google option here: staff and admins sign in with their password only.
 */
export function PasswordSignIn({
  onSignIn,
  error,
  submitLabel = 'Sign in',
}: {
  /** Resolves true when signed in, false when refused (the reason arrives as `error`). */
  onSignIn: (email: string, password: string) => Promise<boolean>;
  /** Why the last sign-in was refused, or why the session ended. */
  error?: string | null;
  submitLabel?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      if (!(await onSignIn(email, password))) setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={(e) => void submit(e)} noValidate>
      <FormError error={error ?? null} />
      <Field label="Email">
        {(p) => (
          <Input
            {...p}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            required
          />
        )}
      </Field>
      <Field label="Password">
        {(p) => (
          <Input
            {...p}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        )}
      </Field>
      <Button type="submit" loading={busy} disabled={!email.trim() || !password}>
        {submitLabel}
      </Button>
    </form>
  );
}

/**
 * Change the signed-in account's password (staff Account page, admin
 * Settings page). The current password is required; other devices are
 * signed out when it changes.
 */
export function ChangePasswordForm({
  onChange,
}: {
  onChange: (change: PasswordChange) => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const problem = newPasswordProblem(newPassword, confirmation);
  const sameAsCurrent = newPassword.length > 0 && newPassword === currentPassword;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setDone(false);
    if (!currentPassword || problem || sameAsCurrent) return;
    setBusy(true);
    setError(null);
    try {
      await onChange({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setTouched(false);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : err);
    } finally {
      setBusy(false);
    }
  };

  const fieldError = touched
    ? sameAsCurrent
      ? 'Choose a password different from the current one.'
      : (problem ?? undefined)
    : undefined;

  return (
    <form className="section-body form narrow" onSubmit={(e) => void submit(e)} noValidate>
      <FormError error={error} />
      {done ? (
        <p className="notice notice-info" role="status">
          Password changed. Other devices signed in to this account have been signed out.
        </p>
      ) : null}
      <Field label="Current password">
        {(p) => (
          <Input
            {...p}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        )}
      </Field>
      <Field label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
        {(p) => (
          <Input
            {...p}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        )}
      </Field>
      <Field label="Confirm new password" error={fieldError}>
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
      <Button
        type="submit"
        loading={busy}
        disabled={!currentPassword || !newPassword || !confirmation}
      >
        Change password
      </Button>
    </form>
  );
}
