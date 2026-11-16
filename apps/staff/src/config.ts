/** Build-time public configuration (see .env.example). */
function required(name: string, value: string | undefined): string {
  if (!value)
    throw new Error(
      `Missing ${name}. Copy apps/staff/.env.example to apps/staff/.env.development.local.`,
    );
  return value;
}

const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;

export const config = {
  /**
   * Backend origin. Development names it explicitly (the Vite server is not the
   * backend); a build without VITE_API_URL calls the origin that served it.
   */
  apiUrl: import.meta.env.DEV
    ? required('VITE_API_URL', configuredApiUrl)
    : configuredApiUrl || window.location.origin,
  /** The student app (links from the dashboard). */
  studentAppUrl:
    (import.meta.env.VITE_STUDENT_APP_URL as string | undefined) ||
    (import.meta.env.DEV ? 'http://localhost:5555' : window.location.origin),
  /**
   * This app's root URL: Google sign-in returns here. Same origin as the page
   * (with the /staff/ or /admin/ base on the single domain).
   */
  appUrl: new URL(import.meta.env.BASE_URL, window.location.origin).toString(),
};
