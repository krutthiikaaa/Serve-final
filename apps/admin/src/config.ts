/** Build-time public configuration (see .env.example). */
function required(name: string, value: string | undefined): string {
  if (!value)
    throw new Error(
      `Missing ${name}. Copy apps/admin/.env.example to apps/admin/.env.development.local.`,
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
  firebase: {
    apiKey: required(
      'VITE_FIREBASE_API_KEY',
      import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    ),
    projectId: required(
      'VITE_FIREBASE_PROJECT_ID',
      import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    ),
    authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || undefined,
    emulatorUrl: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL as string | undefined,
  },
};
