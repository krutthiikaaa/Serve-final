/** Development-only SSO diagnostics. Never pass tokens, codes, or secrets. */
export function ssoLog(step: string, detail: Record<string, unknown> = {}): void {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console -- development-only diagnostics, gated on import.meta.env.DEV
  console.info(`[serve:sso] ${step}`, detail);
}
