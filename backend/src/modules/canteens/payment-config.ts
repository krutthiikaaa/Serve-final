import type { PaymentMode, Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import { toDemoQr } from './demo-qr.js';

export type PaymentConfigRow = {
  canteenId: string;
  mode: PaymentMode;
  upiVpa: string | null;
  merchantName: string | null;
  qrImageUrl: string | null;
  qrStorageKey: string | null;
  instructions: string | null;
  isActive: boolean;
  updatedAt: Date;
};

export function officialDetailsReady(row: {
  upiVpa: string | null;
  merchantName: string | null;
  qrImageUrl: string | null;
  qrStorageKey: string | null;
}): boolean {
  return Boolean(row.upiVpa && row.merchantName && (row.qrImageUrl || row.qrStorageKey));
}

export function paymentConfigWarnings(row: PaymentConfigRow): string[] {
  if (row.mode === 'DEMO') return ['DEMO_MODE_ACTIVE'];
  if (!officialDetailsReady(row)) return ['LIVE_CONFIG_INCOMPLETE'];
  return [];
}

export function toAdminPaymentConfigDto(row: PaymentConfigRow) {
  return {
    canteenId: row.canteenId,
    mode: row.mode,
    upiVpa: row.upiVpa,
    merchantName: row.merchantName,
    qrImageUrl: row.qrImageUrl,
    qrStorageKey: row.qrStorageKey,
    instructions: row.instructions,
    isActive: row.isActive,
    demoQr: row.mode === 'DEMO' ? toDemoQr(row.canteenId) : null,
    warnings: paymentConfigWarnings(row),
    updatedAt: row.updatedAt,
  };
}

/** Cashier-facing config. Official VPA/QR are omitted in DEMO so they cannot be treated as payable. */
export function toStaffPaymentConfigDto(row: PaymentConfigRow) {
  const demo = row.mode === 'DEMO';
  return {
    canteenId: row.canteenId,
    mode: row.mode,
    upiVpa: demo ? null : row.upiVpa,
    merchantName: demo ? null : row.merchantName,
    qrImageUrl: demo ? null : row.qrImageUrl,
    instructions: demo ? null : row.instructions,
    isActive: row.isActive,
    demoQr: demo ? toDemoQr(row.canteenId) : null,
    warnings: paymentConfigWarnings(row),
    updatedAt: row.updatedAt,
  };
}

/**
 * Student checkout config. Same DEMO redaction as staff, plus LIVE drafts are
 * hidden until official details are complete. Never includes `qrStorageKey`.
 */
export function toStudentPaymentConfigDto(row: PaymentConfigRow) {
  const staff = toStaffPaymentConfigDto(row);
  if (row.mode === 'LIVE' && !officialDetailsReady(row)) {
    return {
      ...staff,
      upiVpa: null,
      merchantName: null,
      qrImageUrl: null,
      instructions: null,
      demoQr: null,
    };
  }
  return staff;
}

export async function ensureDemoPaymentConfig(
  prisma: PrismaClient | Prisma.TransactionClient,
  canteenId: string,
): Promise<PaymentConfigRow> {
  const existing = await prisma.canteenPaymentConfig.findUnique({ where: { canteenId } });
  if (existing) return existing;
  try {
    return await prisma.canteenPaymentConfig.create({
      data: { canteenId, mode: 'DEMO', isActive: false },
    });
  } catch (err) {
    const raced = await prisma.canteenPaymentConfig.findUnique({ where: { canteenId } });
    if (raced) return raced;
    throw err;
  }
}

export async function requireCanteenPaymentMode(
  prisma: PrismaClient | Prisma.TransactionClient,
  canteenId: string,
  expected: PaymentMode,
): Promise<PaymentConfigRow> {
  const row = await ensureDemoPaymentConfig(prisma, canteenId);
  if (row.mode !== expected) {
    throw new ConflictError(
      expected === 'LIVE'
        ? 'This canteen is in DEMO mode. Use simulated confirmation.'
        : 'This canteen is LIVE. Simulated confirmation is not allowed.',
      expected === 'LIVE' ? 'LIVE_CONFIRMATION_NOT_ALLOWED' : 'DEMO_CONFIRMATION_NOT_ALLOWED',
    );
  }
  if (expected === 'LIVE' && !officialDetailsReady(row)) {
    throw new ValidationError(
      'LIVE mode requires a valid UPI ID, merchant name, and official QR.',
      undefined,
      'LIVE_CONFIG_INCOMPLETE',
    );
  }
  return row;
}
