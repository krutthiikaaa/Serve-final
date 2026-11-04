import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AdminPaymentOverview } from '@serve/contracts';
import { PaymentCanteenPage, PaymentsPage } from '../src/pages/PaymentsPage';
import { adminCanteenDetail, adminCanteen, fakeAdminApi, renderAdmin, uuid } from './fixtures';

const overview = (): AdminPaymentOverview => ({
  totals: { canteens: 2, demo: 1, live: 1, incompleteLive: 1 },
  canteens: [
    {
      id: uuid(),
      name: 'Testing Canteen',
      mode: 'DEMO',
      merchantName: null,
      upiConfigured: false,
      qrConfigured: false,
      incomplete: false,
      updatedAt: '2026-10-06T18:00:00.000Z',
    },
    {
      id: uuid(),
      name: 'Live Canteen',
      mode: 'LIVE',
      merchantName: 'Live Mess',
      upiConfigured: false,
      qrConfigured: true,
      incomplete: true,
      updatedAt: '2026-10-06T18:00:00.000Z',
    },
  ],
});

describe('payments and QR', () => {
  it('separates DEMO and incomplete LIVE canteens', async () => {
    const api = fakeAdminApi();
    api.paymentOverview.mockResolvedValue(overview());
    renderAdmin(<PaymentsPage />, { api });
    expect(await screen.findByText('Testing Canteen')).toBeInTheDocument();
    expect(screen.getAllByText('DEMO').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0);
    expect(screen.getByText('Live Mess')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.queryByText(/upi@/i)).not.toBeInTheDocument();
  });

  it('opens the existing payment form for one canteen', async () => {
    const api = fakeAdminApi();
    const listed = adminCanteen('Testing Canteen');
    api.canteen.mockResolvedValue(adminCanteenDetail(listed));
    api.paymentConfig.mockResolvedValue({
      canteenId: listed.id,
      mode: 'DEMO',
      upiVpa: null,
      merchantName: null,
      qrImageUrl: null,
      instructions: null,
      isActive: false,
      demoQr: {
        payload: 'demo',
        svg: '<svg></svg>',
        warning: 'DEMO ONLY — NOT PAYABLE',
      },
      warnings: ['DEMO_MODE_ACTIVE'],
      updatedAt: '2026-10-06T18:00:00.000Z',
    });
    renderAdmin(
      <Routes>
        <Route path="/payments/:canteenId" element={<PaymentCanteenPage />} />
      </Routes>,
      { api, path: `/payments/${listed.id}` },
    );
    expect(await screen.findByText('UPI payments')).toBeInTheDocument();
    expect(screen.getByText(/DEMO ONLY — NOT PAYABLE/)).toBeInTheDocument();
  });
});
