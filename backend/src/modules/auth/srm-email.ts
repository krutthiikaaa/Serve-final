/**
 * The one sign-in rule SERVE applies to every role: a Google account whose
 * email Google has verified and that ends exactly in `@srmap.edu.in`.
 *
 * Exact matching (after trimming and lower-casing):
 *   allowed   student@srmap.edu.in
 *   rejected  student@gmail.com, student@srmap.edu.in.attacker.com,
 *             student@fake-srmap.edu.in, student@mail.srmap.edu.in,
 *             "a@b"@srmap.edu.in, addresses with spaces or non-ASCII letters
 * The address is always taken from the identity provider, never from a
 * request body.
 */
export const SRM_EMAIL_DOMAIN = 'srmap.edu.in';

/** Plain ASCII local part as issued by Google Workspace (no quotes, spaces or Unicode look-alikes). */
const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_%+-])?$/;

/** Trimmed, lower-cased address, or null when the value is not a string. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length > 0 && email.length <= 254 ? email : null;
}

/** True only for `<plain local part>@srmap.edu.in`. */
export function isSrmEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  if (!email) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return domain === SRM_EMAIL_DOMAIN && LOCAL_PART.test(local) && !local.includes('..');
}

export type SrmEmailRejection = 'EMAIL_DOMAIN_NOT_ALLOWED' | 'EMAIL_NOT_VERIFIED';

/** Why an identity may not sign in, or null when it may. */
export function srmIdentityRejection(identity: {
  email: unknown;
  emailVerified: unknown;
}): SrmEmailRejection | null {
  if (!isSrmEmail(identity.email)) return 'EMAIL_DOMAIN_NOT_ALLOWED';
  // Google reports email_verified as a boolean (some providers send "true").
  if (identity.emailVerified !== true && identity.emailVerified !== 'true') {
    return 'EMAIL_NOT_VERIFIED';
  }
  return null;
}

export const SRM_REJECTION_MESSAGE: Record<SrmEmailRejection, string> = {
  EMAIL_DOMAIN_NOT_ALLOWED: 'Sign in with your SRM University-AP Google account (@srmap.edu.in).',
  EMAIL_NOT_VERIFIED:
    'Your Google account email is not verified. Verify it with Google and try again.',
};
