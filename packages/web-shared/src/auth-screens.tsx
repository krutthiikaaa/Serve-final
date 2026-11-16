import { useState, type ReactNode } from 'react';
import { Button, FormError, Logo, SERVE_TAGLINE } from './ui/components';

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

/** Google "G" mark (brand colours), drawn inline: no third-party script or image. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 7.2-9.6 7.2-16.9z"
      />
      <path
        fill="#FBBC05"
        d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.2-8.8 2.2-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

/**
 * Sign-in with Google (SRM University-AP accounts only). The browser goes to
 * Google and returns signed in; a refused account comes back with a reason.
 */
export function GoogleSignIn({
  onSignIn,
  error,
  label = 'Continue with Google',
}: {
  onSignIn: () => Promise<void>;
  /** Why the last sign-in was refused, if it was. */
  error?: string | null;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await onSignIn();
    } catch {
      setFailure('Unable to reach SERVE. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <FormError error={failure ?? error ?? null} />
      <Button variant="secondary" icon={<GoogleMark />} loading={busy} onClick={() => void start()}>
        {label}
      </Button>
      <p className="muted small">
        Use your SRM University-AP Google account (<strong>@srmap.edu.in</strong>). Other accounts
        cannot sign in.
      </p>
    </div>
  );
}
