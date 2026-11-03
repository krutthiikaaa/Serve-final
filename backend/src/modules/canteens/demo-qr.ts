import { createHash } from 'node:crypto';

export const DEMO_QR_WARNING = 'DEMO ONLY — NOT PAYABLE';

/** Non-payment payload unique to one canteen. Never a `upi://` URI. */
export function demoQrPayload(canteenId: string): string {
  return `SERVE-DEMO:${canteenId}`;
}

export function containsPaymentUri(value: string): boolean {
  return /upi:\/\//i.test(value);
}

/**
 * QR-style SVG placeholder derived from the canteen id. It is not a valid UPI
 * QR and must never be written into `CanteenPaymentConfig.qrImageUrl`.
 */
export function demoQrSvg(canteenId: string): string {
  const payload = demoQrPayload(canteenId);
  const digest = createHash('sha256').update(payload).digest();
  const n = 21;
  const cell = 6;
  const pad = 10;
  const dim = n * cell + pad * 2;
  const modules: boolean[][] = Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => moduleOn(x, y, n, digest)),
  );
  const rects: string[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (!modules[y]![x]) continue;
      rects.push(
        `<rect x="${pad + x * cell}" y="${pad + y * cell}" width="${cell}" height="${cell}"/>`,
      );
    }
  }
  const labelY = dim + 16;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${labelY + 6}" width="${dim}" height="${labelY + 6}" role="img" aria-label="${DEMO_QR_WARNING}">`,
    `<rect width="${dim}" height="${labelY + 6}" fill="#ffffff"/>`,
    `<g fill="#111111">${rects.join('')}</g>`,
    `<text x="${dim / 2}" y="${labelY}" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="#9a3412">${DEMO_QR_WARNING}</text>`,
    '</svg>',
  ].join('');
}

export function toDemoQr(canteenId: string) {
  const payload = demoQrPayload(canteenId);
  const svg = demoQrSvg(canteenId);
  return { payload, svg, warning: DEMO_QR_WARNING as typeof DEMO_QR_WARNING };
}

function inFinder(x: number, y: number, originX: number, originY: number): boolean {
  const dx = x - originX;
  const dy = y - originY;
  if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
  const ring = Math.min(dx, dy, 6 - dx, 6 - dy);
  return ring === 0 || ring === 1 ? ring === 0 : true;
}

function finderFamily(x: number, y: number, n: number): boolean {
  return inFinder(x, y, 0, 0) || inFinder(x, y, n - 7, 0) || inFinder(x, y, 0, n - 7);
}

function moduleOn(x: number, y: number, n: number, digest: Buffer): boolean {
  if (finderFamily(x, y, n)) return true;
  const i = (y * n + x) % (digest.length * 8);
  return ((digest[Math.floor(i / 8)]! >> i % 8) & 1) === 1;
}
