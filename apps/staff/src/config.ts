/** Build-time public configuration (see .env.example). */
function required(name: string, value: string | undefined): string {
  if (!value)
    throw new Error(
      `Missing ${name}. Copy apps/staff/.env.example to apps/staff/.env.development.local.`,
    );
  return value;
}

export const config = {
  apiUrl: required('VITE_API_URL', import.meta.env.VITE_API_URL as string | undefined),
  firebase: {
    apiKey: required(
      'VITE_FIREBASE_API_KEY',
      import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    ),
    projectId: required(
      'VITE_FIREBASE_PROJECT_ID',
      import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    ),
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    emulatorUrl: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL as string | undefined,
  },
};
