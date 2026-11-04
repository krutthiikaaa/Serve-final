import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AdminReport } from '@serve/contracts';
import { ReportsPage } from '../src/pages/ReportsPage';
import { fakeAdminApi, renderAdmin, uuid } from './fixtures';

function report(overrides: Partial<AdminReport> = {}): AdminReport {
  return {
    range: { from: '2026-10-01', to: '2026-10-07' },
    filters: {
      canteenId: null,
      servicePeriod: null,
      channel: null,
      paymentMethod: null,
      paymentMode: null,
    },
    orders: { total: 4, app: 3, walkIn: 1, cancelled: 1 },
    payments: {
      liveSalesPaise: 100_000,
      cashSalesPaise: 20_000,
      upiSalesPaise: 30_000,
      otherLiveSalesPaise: 50_000,
      demoSalesPaise: 15_000,
      rejected: 2,
    },
    series: [{ date: '2026-10-07', liveSalesPaise: 100_000, orderCount: 2 }],
    byCanteen: [{ id: uuid(), name: 'Vedavathi', liveSalesPaise: 100_000, orderCount: 2 }],
    byPeriod: [
      { period: 'DAY', liveSalesPaise: 40_000, orderCount: 1 },
      { period: 'NIGHT', liveSalesPaise: 60_000, orderCount: 1 },
      { period: 'UNSET', liveSalesPaise: 0, orderCount: 0 },
    ],
    byChannel: [
      { channel: 'APP', orderCount: 3, liveSalesPaise: 80_000 },
      { channel: 'WALK_IN', orderCount: 1, liveSalesPaise: 20_000 },
    ],
    byMethod: [
      { method: 'CASH', liveSalesPaise: 20_000 },
      { method: 'UPI', liveSalesPaise: 30_000 },
      { method: 'OTHER', liveSalesPaise: 50_000 },
    ],
    topItems: [{ name: 'Egg Roll', quantity: 6, liveSalesPaise: 27_000 }],
    ...overrides,
  };
}

describe('reports', () => {
  it('shows backend LIVE sales and keeps DEMO separate', async () => {
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([]);
    api.reports.mockResolvedValue(report());
    renderAdmin(<ReportsPage />, { api });
    const live = (await screen.findByText('Successful LIVE sales')).closest('.kpi')!;
    expect(live).toHaveTextContent('₹1,000');
    expect(screen.getByText(/DEMO sales in this range: ₹150/)).toBeInTheDocument();
    expect(live).not.toHaveTextContent('₹1,150');
    expect(screen.getByText('Egg Roll')).toBeInTheDocument();
  });

  it('shows an empty state when the backend reports nothing', async () => {
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([]);
    api.reports.mockResolvedValue(
      report({
        orders: { total: 0, app: 0, walkIn: 0, cancelled: 0 },
        payments: {
          liveSalesPaise: 0,
          cashSalesPaise: 0,
          upiSalesPaise: 0,
          otherLiveSalesPaise: 0,
          demoSalesPaise: 0,
          rejected: 0,
        },
        series: [],
        byCanteen: [],
        topItems: [],
      }),
    );
    renderAdmin(<ReportsPage />, { api });
    expect(await screen.findByText('No orders in this range')).toBeInTheDocument();
  });
});
