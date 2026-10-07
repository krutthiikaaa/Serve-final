import { Link } from 'react-router-dom';
import { AuthLayout, SignInForm, useAuth } from '@serve/web-shared';

export function LoginPage() {
  const { signIn } = useAuth();
  return (
    <AuthLayout subtitle="Staff dashboard">
      <section className="section">
        <div className="section-body">
          <SignInForm onSubmit={signIn} />
        </div>
      </section>
      <p className="auth-switch">
        New canteen staff? <Link to="/create-account">Request access</Link>
      </p>
    </AuthLayout>
  );
}
