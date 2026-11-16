import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CanteenPaymentConfig, QrOverview } from '@serve/contracts';
import { QrSection } from '../src/pages/canteen/QrSection';
import { fakeAdminApi, renderAdmin, uuid } from './fixtures';

const canteenId = uuid();
const at = '2026-11-16T10:00:00.000Z';

const config = (): CanteenPaymentConfig => ({
  canteenId,
  mode: 'DEMO',
  upiVpa: null,
  merchantName: null,
  qrImageUrl: null,
  qrStorageKey: null,
  instructions: null,
  isActive: false,
  demoQr: { payload: `SERVE-DEMO:${canteenId}`, svg: '<svg/>', warning: 'DEMO ONLY — NOT PAYABLE' },
  qr: null,
  warnings: ['DEMO_MODE_ACTIVE'],
  updatedAt: at,
});

const record = (id: string, isActive: boolean) => ({
  id,
  canteenId,
  url: `/api/qr-codes/${id}`,
  contentType: 'image/png',
  sizeBytes: 2048,
  isActive,
  uploadedAt: at,
  deactivatedAt: isActive ? null : at,
  uploadedBy: { id: uuid(), name: 'Ops Admin' },
});

const overview = (active: ReturnType<typeof record> | null, history = active ? [active] : []) =>
  ({
    canteen: { id: canteenId, name: 'K&G Day Canteen', type: 'DAY' },
    mode: 'DEMO',
    studentSees: 'PLACEHOLDER',
    active,
    history,
  }) satisfies QrOverview;

const png = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'qr.png', { type: 'image/png' });

describe('per-canteen payment QR', () => {
  it('shows the labelled DEMO placeholder until a QR is uploaded, then previews it', async () => {
    const api = fakeAdminApi();
    const first = record(uuid(), true);
    api.paymentConfig.mockResolvedValue(config());
    api.qr.mockResolvedValueOnce(overview(null)).mockResolvedValue(overview(first));
    api.uploadQr.mockResolvedValue(overview(first));
    renderAdmin(<QrSection canteenId={canteenId} canteenName="K&G Day Canteen" />, { api });

    expect(await screen.findByAltText('DEMO ONLY — NOT PAYABLE')).toBeInTheDocument();
    expect(screen.getByText('Placeholder (DEMO)')).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('QR image file'), png());
    await waitFor(() => expect(api.uploadQr).toHaveBeenCalledWith(canteenId, expect.any(File)));
    const img = await screen.findByAltText('Payment QR for K&G Day Canteen');
    expect(img).toHaveAttribute('src', `http://api.test/api/qr-codes/${first.id}`);
    expect(screen.getByRole('button', { name: 'Replace QR' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('rejects unsupported or oversized files before uploading', async () => {
    const api = fakeAdminApi();
    api.paymentConfig.mockResolvedValue(config());
    api.qr.mockResolvedValue(overview(null));
    renderAdmin(<QrSection canteenId={canteenId} canteenName="K&G Day Canteen" />, { api });
    await screen.findByRole('button', { name: 'Upload QR' });
    const input = screen.getByLabelText('QR image file');
    await userEvent.upload(input, new File(['<svg/>'], 'qr.svg', { type: 'image/svg+xml' }), {
      applyAccept: false,
    });
    expect(await screen.findByText('Choose a PNG, JPEG or WEBP image.')).toBeInTheDocument();
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await userEvent.upload(input, big);
    expect(await screen.findByText('The QR image must be 1 MB or smaller.')).toBeInTheDocument();
    expect(api.uploadQr).not.toHaveBeenCalled();
  });

  it('removes the QR only after confirmation and keeps the history', async () => {
    const api = fakeAdminApi();
    const old = record(uuid(), false);
    const current = record(uuid(), true);
    api.paymentConfig.mockResolvedValue(config());
    api.qr.mockResolvedValue(overview(current, [current, old]));
    api.removeQr.mockResolvedValue(overview(null, [current, old]));
    renderAdmin(<QrSection canteenId={canteenId} canteenName="K&G Day Canteen" />, { api });
    expect(await screen.findByText('Previous QR codes (1)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(api.removeQr).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Remove this QR?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove QR' }));
    expect(api.removeQr).toHaveBeenCalledWith(canteenId);
  });
});
