import { randomUUID } from 'node:crypto';
import { testEnv } from './test-app.js';

/**
 * Real Firebase Auth Emulator accounts (REST API identical to production
 * Identity Toolkit). Tokens returned here are genuine emulator ID tokens.
 */
const env = testEnv();
const host = env.FIREBASE_AUTH_EMULATOR_HOST;
if (!host) throw new Error('Tests require FIREBASE_AUTH_EMULATOR_HOST');

const API = `http://${host}/identitytoolkit.googleapis.com/v1`;
const KEY = 'demo-api-key';
export const TEST_PASSWORD = 'Serve-test-password-1';

export interface FirebaseTestUser {
  uid: string;
  email: string;
  idToken: string;
}

export const uniqueEmail = (prefix = 'user') => `${prefix}-${randomUUID().slice(0, 8)}@example.edu`;

async function identityToolkit(path: string, body: object): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/${path}?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Auth emulator ${path} failed: ${JSON.stringify(json)}`);
  return json;
}

export async function createFirebaseUser(email = uniqueEmail()): Promise<FirebaseTestUser> {
  const json = await identityToolkit('accounts:signUp', {
    email,
    password: TEST_PASSWORD,
    returnSecureToken: true,
  });
  return { uid: String(json.localId), email: email.toLowerCase(), idToken: String(json.idToken) };
}

export async function signIn(email: string): Promise<string> {
  const json = await identityToolkit('accounts:signInWithPassword', {
    email,
    password: TEST_PASSWORD,
    returnSecureToken: true,
  });
  return String(json.idToken);
}
