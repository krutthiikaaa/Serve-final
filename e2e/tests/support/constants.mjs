/**
 * Ports and fixed accounts for the isolated E2E stack. Staff and admins sign
 * in with the real email + password flow. Students sign in with Google, which
 * cannot run in automation: the backend's test-only endpoint
 * (NODE_ENV=test + AUTH_TEST_SIGN_IN=true) stands in for it with the same
 * SRM rule (verified @srmap.edu.in) and records a Google session.
 */
export const E2E = {
  apiPort: 5101,
  apiUrl: 'http://localhost:5101',
  staffUrl: 'http://localhost:5273',
  adminUrl: 'http://localhost:5274',
  studentUrl: 'http://localhost:5455',
  adminEmail: 'e2e.admin@srmap.edu.in',
  /** Password of the E2E admin and of every staff account the suite registers (test-only). */
  password: 'e2e-only-password-not-secret',
};
