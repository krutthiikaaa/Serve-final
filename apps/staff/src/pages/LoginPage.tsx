import { Link } from 'react-router-dom';
import { AuthLayout, GoogleSignIn, useAuth } from '@serve/web-shared';

export function LoginPage() {
  const { signInWithGoogle, signInError } = useAuth();
  return (
    <AuthLayout subtitle="Staff dashboard">
      <section className="section">
        <div className="section-body">
          <GoogleSignIn onSignIn={signInWithGoogle} error={signInError} />
        </div>
      </section>
      <p className="auth-switch">
        New canteen staff? <Link to="/create-account">Request access</Link>
      </p>
    </AuthLayout>
  );
}
