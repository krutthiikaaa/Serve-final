import { describe, expect, it } from 'vitest';
import {
  DEMO_QR_WARNING,
  containsPaymentUri,
  demoQrPayload,
  demoQrSvg,
} from '../../src/modules/canteens/demo-qr.js';

describe('demo QR placeholders', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';

  it('is unique per canteen and never a UPI payment URI', () => {
    expect(demoQrPayload(a)).toBe(`SERVE-DEMO:${a}`);
    expect(demoQrPayload(a)).not.toBe(demoQrPayload(b));
    expect(containsPaymentUri(demoQrPayload(a))).toBe(false);
    expect(containsPaymentUri(demoQrSvg(a))).toBe(false);
    expect(demoQrSvg(a)).toContain(DEMO_QR_WARNING);
    expect(demoQrSvg(a)).not.toBe(demoQrSvg(b));
    expect(demoQrSvg(a)).not.toMatch(/upi:\/\//i);
  });
});
