/** Development-only SSO diagnostics. Never pass tokens, codes, or secrets. */
export function ssoLog(step: string, detail: Record<string, unknown> = {}): void {
  if (!import.meta.env.DEV) return;
  console.info(`[serve:sso] ${step}`, detail);
}
