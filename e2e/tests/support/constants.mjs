/**
 * Ports and fixed accounts for the isolated E2E stack. Sign-in uses the
 * backend's test-only endpoint (NODE_ENV=test + AUTH_TEST_SIGN_IN=true),
 * which applies the same SRM rule as Google: every account is @srmap.edu.in.
 */
export const E2E = {
  apiPort: 5101,
  apiUrl: 'http://localhost:5101',
  staffUrl: 'http://localhost:5273',
  adminUrl: 'http://localhost:5274',
  studentUrl: 'http://localhost:5455',
  adminEmail: 'e2e.admin@srmap.edu.in',
  /** Kept for call compatibility; Google sign-in has no password. */
  password: 'unused-google-sign-in',
};
