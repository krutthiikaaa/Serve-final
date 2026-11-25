import { Link } from 'react-router-dom';
import { AuthLayout, PasswordSignIn, useAuth } from '@serve/web-shared';

/** Staff sign in with their email and password (no Google sign-in for staff). */
export function LoginPage() {
  const { signInWithPassword, signInError } = useAuth();
  return (
    <AuthLayout subtitle="Staff dashboard">
      <section className="section">
        <div className="section-body">
          <PasswordSignIn onSignIn={signInWithPassword} error={signInError} />
        </div>
      </section>
      <p className="auth-switch">
        New canteen staff? <Link to="/create-account">Request access</Link>
      </p>
    </AuthLayout>
  );
}
