import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import type { PrismaClient } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { Outbox, rooms, type EventPublisher } from '../../realtime/events.js';
import type { AdminPrincipal } from '../auth/principal.js';
import { ensureDemoPaymentConfig } from './payment-config.js';

/**
 * Per-canteen payment QR images, stored in PostgreSQL (no extra storage
 * service or dependency). Rows are immutable: replacing a QR deactivates the
 * previous row (kept as history) and inserts a new one, so the image URL
 * `/api/qr-codes/:id` changes on every upload and can be cached forever.
 * Clients therefore always load the latest QR, and a stale cache can never
 * show an outdated or another canteen's code.
 */

export const QR_MAX_BYTES = 1024 * 1024;
export const QR_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type QrContentType = (typeof QR_CONTENT_TYPES)[number];

/** Storage key / URL written into CanteenPaymentConfig for an uploaded QR. */
export const qrStorageKey = (id: string) => `db:canteen-qr/${id}`;
export const qrImagePath = (id: string) => `/api/qr-codes/${id}`;
const STORAGE_PREFIX = 'db:canteen-qr/';

/** Detect the real image type from magic bytes. SVG and anything else: null. */
export function sniffImageType(bytes: Buffer): QrContentType | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Validate an upload. The declared Content-Type must match the bytes. */
export function validateQrImage(bytes: Buffer, declaredType: string | undefined): QrContentType {
  if (bytes.length === 0) {
    throw new ValidationError('Choose a QR image to upload.', undefined, 'QR_IMAGE_REQUIRED');
  }
  if (bytes.length > QR_MAX_BYTES) {
    throw new ValidationError(
      'The QR image must be 1 MB or smaller.',
      { maxBytes: QR_MAX_BYTES },
      'QR_IMAGE_TOO_LARGE',
    );
  }
  const detected = sniffImageType(bytes);
  const declared = (declaredType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!detected || detected !== declared) {
    throw new ValidationError(
      'Upload a PNG, JPEG or WEBP image.',
      { allowed: QR_CONTENT_TYPES },
      'QR_IMAGE_TYPE_INVALID',
    );
  }
  return detected;
}

const qrMetaSelect = {
  id: true,
  canteenId: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  isActive: true,
  createdAt: true,
  deactivatedAt: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;

type QrMeta = {
  id: string;
  canteenId: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  isActive: boolean;
  createdAt: Date;
  deactivatedAt: Date | null;
  uploadedBy: { id: string; name: string } | null;
};

export function toQrDto(row: QrMeta) {
  return {
    id: row.id,
    canteenId: row.canteenId,
    url: qrImagePath(row.id),
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    isActive: row.isActive,
    uploadedAt: row.createdAt,
    deactivatedAt: row.deactivatedAt,
    uploadedBy: row.uploadedBy,
  };
}

export function createQrCodesService(prisma: PrismaClient, events: EventPublisher, logger: Logger) {
  async function requireCanteen(canteenId: string) {
    const canteen = await prisma.canteen.findUnique({
      where: { id: canteenId },
      select: { id: true, name: true, type: true },
    });
    if (!canteen) throw new NotFoundError('Canteen not found.', 'CANTEEN_NOT_FOUND');
    return canteen;
  }

  function announce(canteenId: string, qrId: string | null) {
    const outbox = new Outbox();
    outbox.emit(
      'canteen.payment_qr_updated',
      [rooms.canteenPublic(canteenId), rooms.canteen(canteenId), rooms.admins()],
      { canteenId, qrId, updatedAt: new Date().toISOString() },
    );
    outbox.flush(events);
  }

  async function qrOverview(canteenId: string) {
    const canteen = await requireCanteen(canteenId);
    const [rows, config] = await Promise.all([
      prisma.canteenQrCode.findMany({
        where: { canteenId },
        select: qrMetaSelect,
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      ensureDemoPaymentConfig(prisma, canteenId),
    ]);
    const active = rows.find((row) => row.isActive) ?? null;
    return {
      canteen,
      mode: config.mode,
      /** What students see at checkout right now. */
      studentSees:
        config.mode === 'LIVE' && active ? ('UPLOADED_QR' as const) : ('PLACEHOLDER' as const),
      active: active ? toQrDto(active) : null,
      history: rows.map(toQrDto),
    };
  }

  return {
    qrOverview,

    async uploadQr(
      admin: AdminPrincipal,
      canteenId: string,
      bytes: Buffer,
      declaredType: string | undefined,
    ) {
      await requireCanteen(canteenId);
      const contentType = validateQrImage(bytes, declaredType);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await ensureDemoPaymentConfig(prisma, canteenId);
      let created: { id: string };
      let previousId: string | null = null;
      try {
        created = await prisma.$transaction(async (tx) => {
          // Serialize uploads for one canteen.
          await tx.$queryRaw`SELECT "id" FROM "Canteen" WHERE "id" = ${canteenId}::uuid FOR UPDATE`;
          const previous = await tx.canteenQrCode.findFirst({
            where: { canteenId, isActive: true },
            select: { id: true },
          });
          previousId = previous?.id ?? null;
          if (previous) {
            await tx.canteenQrCode.update({
              where: { id: previous.id },
              data: { isActive: false, deactivatedAt: new Date() },
            });
          }
          const row = await tx.canteenQrCode.create({
            data: {
              canteenId,
              contentType,
              sizeBytes: bytes.length,
              sha256,
              data: new Uint8Array(bytes),
              uploadedByAdminId: admin.id,
            },
            select: { id: true },
          });
          await tx.canteenPaymentConfig.update({
            where: { canteenId },
            data: { qrStorageKey: qrStorageKey(row.id), qrImageUrl: qrImagePath(row.id) },
          });
          return row;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            'Another QR upload for this canteen finished at the same moment. Refresh and try again.',
            'QR_UPLOAD_CONFLICT',
          );
        }
        throw err;
      }
      writeAudit(logger, {
        actor: { role: 'ADMIN', id: admin.id },
        action: previousId ? 'admin.canteen.qr.replaced' : 'admin.canteen.qr.uploaded',
        target: { type: 'canteen', id: canteenId },
        before: { qrId: previousId },
        after: { qrId: created.id, contentType, sizeBytes: bytes.length, sha256 },
      });
      announce(canteenId, created.id);
      return qrOverview(canteenId);
    },

    /** Deactivate the current QR. Students fall back to the placeholder. */
    async removeQr(admin: AdminPrincipal, canteenId: string) {
      await requireCanteen(canteenId);
      const config = await ensureDemoPaymentConfig(prisma, canteenId);
      const active = await prisma.canteenQrCode.findFirst({
        where: { canteenId, isActive: true },
        select: { id: true },
      });
      if (!active) throw new NotFoundError('This canteen has no active QR.', 'QR_NOT_FOUND');
      if (config.mode === 'LIVE') {
        throw new ConflictError(
          'Live payments need a QR. Switch the canteen to test mode before removing it.',
          'QR_REQUIRED_FOR_LIVE',
        );
      }
      await prisma.$transaction(async (tx) => {
        await tx.canteenQrCode.update({
          where: { id: active.id },
          data: { isActive: false, deactivatedAt: new Date() },
        });
        if (config.qrStorageKey?.startsWith(STORAGE_PREFIX)) {
          await tx.canteenPaymentConfig.update({
            where: { canteenId },
            data: { qrStorageKey: null, qrImageUrl: null },
          });
        }
      });
      writeAudit(logger, {
        actor: { role: 'ADMIN', id: admin.id },
        action: 'admin.canteen.qr.removed',
        target: { type: 'canteen', id: canteenId },
        before: { qrId: active.id },
        after: { qrId: null },
      });
      announce(canteenId, null);
      return qrOverview(canteenId);
    },

    /** Image bytes for an ACTIVE QR only. Historical rows are never served. */
    async qrImage(qrId: string) {
      const row = await prisma.canteenQrCode.findFirst({
        where: { id: qrId, isActive: true },
        select: { contentType: true, data: true, sha256: true },
      });
      if (!row) throw new NotFoundError('QR code not found.', 'QR_NOT_FOUND');
      return { contentType: row.contentType, data: Buffer.from(row.data), sha256: row.sha256 };
    },
  };
}

export type QrCodesService = ReturnType<typeof createQrCodesService>;

/** Active uploaded QR of a canteen, metadata only. */
export async function activeQrOf(prisma: Pick<PrismaClient, 'canteenQrCode'>, canteenId: string) {
  const row = await prisma.canteenQrCode.findFirst({
    where: { canteenId, isActive: true },
    select: qrMetaSelect,
  });
  return row ? toQrDto(row) : null;
}
