import { Link } from 'react-router-dom';
import { AuthLayout, GoogleSignIn, useAuth } from '@serve/web-shared';

/**
 * Step 1 of staff onboarding: sign in with the SRM Google account. Step 2
 * (name + canteen) follows once signed in; an admin then approves access.
 */
export function CreateAccountPage() {
  const { signInWithGoogle, signInError } = useAuth();
  return (
    <AuthLayout subtitle="Request staff access">
      <section className="section">
        <div className="section-body">
          <p className="muted small">
            Sign in with your SRM University-AP Google account, then choose the canteen you work at.
            An admin approves your access before you can operate a canteen.
          </p>
          <GoogleSignIn onSignIn={signInWithGoogle} error={signInError} />
        </div>
      </section>
      <p className="auth-switch">
        Already have access? <Link to="/">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
