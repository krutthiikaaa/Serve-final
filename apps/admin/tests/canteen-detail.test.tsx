import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CanteenDetailPage } from '../src/pages/CanteenDetailPage';
import {
  adminCanteen,
  adminCanteenDetail,
  fakeAdminApi,
  publicCanteen,
  renderAdmin,
  uuid,
} from './fixtures';

function renderDetail(api: ReturnType<typeof fakeAdminApi>, canteenId: string) {
  // Sections that are not under test get neutral data.
  if (!api.serviceAreas.getMockImplementation()) api.serviceAreas.mockResolvedValue([]);
  if (!api.qr.getMockImplementation()) {
    api.qr.mockImplementation(async (id) => ({
      canteen: { id, name: 'Canteen', type: 'NIGHT' },
      mode: 'DEMO',
      studentSees: 'PLACEHOLDER',
      active: null,
      history: [],
    }));
  }
  return renderAdmin(
    <Routes>
      <Route path="/canteens/:id" element={<CanteenDetailPage />} />
    </Routes>,
    { api, path: `/canteens/${canteenId}` },
  );
}

describe('canteen service and hours configuration', () => {
  it('shows backend service status and configuration warnings', async () => {
    const api = fakeAdminApi();
    const listed = adminCanteen('Vedavathi Night Canteen');
    const detail = adminCanteenDetail(listed, {
      configurationWarnings: [
        { period: 'DAY', code: 'AUTO_WITHOUT_SCHEDULE' },
        { period: null, code: 'PERIOD_SCHEDULE_OVERLAP' },
      ],
      services: [
        {
          period: 'NIGHT',
          isEnabled: true,
          override: 'FORCE_OPEN',
          schedules: [],
        },
        { period: 'DAY', isEnabled: true, override: 'AUTO', schedules: [] },
      ],
    });
    api.canteen.mockResolvedValue(detail);
    api.liveCanteen.mockResolvedValue(
      publicCanteen(listed, {
        supportedPeriods: ['DAY', 'NIGHT'],
        services: [
          { period: 'DAY', isEnabled: true, override: 'AUTO', isOpenNow: false },
          { period: 'NIGHT', isEnabled: true, override: 'FORCE_OPEN', isOpenNow: true },
        ],
      }),
    );
    api.menuCatalogue.mockResolvedValue([]);
    api.paymentConfig.mockResolvedValue(null);

    renderDetail(api, listed.id);
    expect(
      await screen.findByText(/Automatic hours are on, but no weekly schedule is set/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Day and Night hours overlap/)).toBeInTheDocument();
    expect(screen.getByText('Temporarily forced open', { selector: '.tag' })).toBeInTheDocument();
  });

  it('saves weekly hours as minutes from midnight', async () => {
    const api = fakeAdminApi();
    const listed = adminCanteen('Vedavathi Night Canteen');
    const detail = adminCanteenDetail(listed);
    api.canteen.mockResolvedValue(detail);
    api.liveCanteen.mockResolvedValue(publicCanteen(listed));
    api.menuCatalogue.mockResolvedValue([]);
    api.paymentConfig.mockResolvedValue(null);
    api.updateCanteenSchedule.mockResolvedValue({
      ...detail,
      services: detail.services ?? [],
      configurationWarnings: [],
    });

    renderDetail(api, listed.id);
    await screen.findByRole('heading', { name: 'Vedavathi Night Canteen' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Monday' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    await waitFor(() =>
      expect(api.updateCanteenSchedule).toHaveBeenCalledWith(
        listed.id,
        'NIGHT',
        expect.arrayContaining([
          expect.objectContaining({ weekday: 1, opensAtMinutes: 9 * 60, closesAtMinutes: 17 * 60 }),
        ]),
      ),
    );
  });

  it('configures only the canteen’s own service (no Day/Night switching)', async () => {
    const api = fakeAdminApi();
    const listed = adminCanteen('Vedavathi Day Canteen');
    api.canteen.mockResolvedValue(adminCanteenDetail(listed, { services: [] }));
    api.liveCanteen.mockResolvedValue(publicCanteen(listed, { services: [] }));
    api.menuCatalogue.mockResolvedValue([]);
    api.paymentConfig.mockResolvedValue(null);
    api.updateCanteenServices.mockResolvedValue({
      ...listed,
      services: [],
      configurationWarnings: [],
    });

    renderDetail(api, listed.id);
    await userEvent.click(await screen.findByRole('button', { name: 'Add Day service' }));
    expect(screen.queryByRole('tablist', { name: 'Service period' })).not.toBeInTheDocument();
    expect(api.updateCanteenServices).toHaveBeenCalledWith(listed.id, [
      { period: 'DAY', isEnabled: true, override: 'AUTO' },
    ]);
  });
});

describe('menu service pricing', () => {
  it('shows a missing price and saves the canteen’s own period price', async () => {
    const api = fakeAdminApi();
    const listed = adminCanteen('Vedavathi Night Canteen');
    const itemId = uuid();
    const categoryId = uuid();
    api.canteen.mockResolvedValue(adminCanteenDetail(listed));
    api.liveCanteen.mockResolvedValue(publicCanteen(listed));
    api.paymentConfig.mockResolvedValue(null);
    api.menuCatalogue.mockResolvedValue([
      {
        id: categoryId,
        canteenId: listed.id,
        name: 'Rolls',
        sortOrder: 0,
        isActive: true,
        updatedAt: '2026-10-06T18:00:00.000Z',
        items: [
          {
            id: itemId,
            canteenId: listed.id,
            categoryId,
            name: 'Egg Roll',
            description: null,
            pricePaise: 4500,
            imageUrl: null,
            isAvailable: true,
            isActive: true,
            availability: 'AVAILABLE',
            isOrderable: true,
            updatedAt: '2026-10-06T18:00:00.000Z',
            services: [],
          },
        ],
      },
    ]);
    api.updateMenuItemServices.mockResolvedValue({
      id: itemId,
      canteenId: listed.id,
      name: 'Egg Roll',
      pricePaise: 4500,
      isAvailable: true,
      services: [{ period: 'NIGHT', pricePaise: 4000, isAvailable: true }],
    });

    renderDetail(api, listed.id);
    expect(screen.queryByRole('tablist', { name: 'Price period' })).not.toBeInTheDocument();
    expect(await screen.findByText('Not configured')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    const dialog = screen.getByRole('dialog', { name: 'Price for Egg Roll' });
    await userEvent.type(within(dialog).getByLabelText('Price (₹)'), '40');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save price' }));
    await waitFor(() =>
      expect(api.updateMenuItemServices).toHaveBeenCalledWith(itemId, [
        { period: 'NIGHT', pricePaise: 4000, isAvailable: true },
      ]),
    );
  });

  it('shows the canteen’s own price for inactive items instead of Not configured', async () => {
    const api = fakeAdminApi();
    const listed = adminCanteen('Vedavathi Night Canteen');
    const itemId = uuid();
    const categoryId = uuid();
    api.canteen.mockResolvedValue(adminCanteenDetail(listed));
    api.liveCanteen.mockResolvedValue(publicCanteen(listed));
    api.paymentConfig.mockResolvedValue(null);
    api.menuCatalogue.mockResolvedValue([
      {
        id: categoryId,
        canteenId: listed.id,
        name: 'Rolls',
        sortOrder: 0,
        isActive: true,
        updatedAt: '2026-10-06T18:00:00.000Z',
        items: [
          {
            id: itemId,
            canteenId: listed.id,
            categoryId,
            name: 'Retired Roll',
            description: null,
            pricePaise: 4500,
            imageUrl: null,
            isAvailable: false,
            isActive: false,
            availability: 'INACTIVE',
            isOrderable: false,
            updatedAt: '2026-10-06T18:00:00.000Z',
            services: [
              { period: 'DAY', pricePaise: 3000, isAvailable: false },
              { period: 'NIGHT', pricePaise: 4000, isAvailable: true },
            ],
          },
        ],
      },
    ]);

    renderDetail(api, listed.id);
    expect(await screen.findByText('Retired Roll')).toBeInTheDocument();
    expect(screen.getByText('₹40')).toBeInTheDocument();
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
    // A Night canteen never shows its dormant Day price.
    expect(screen.queryByText('₹30')).not.toBeInTheDocument();
  });
});

describe('UPI payment configuration', () => {
  it('shows an empty state and saves a new configuration', async () => {
    const api = fakeAdminApi();
    const listed = adminCanteen('Vedavathi Night Canteen');
    api.canteen.mockResolvedValue(adminCanteenDetail(listed));
    api.liveCanteen.mockResolvedValue(publicCanteen(listed));
    api.menuCatalogue.mockResolvedValue([]);
    api.paymentConfig.mockResolvedValue({
      canteenId: listed.id,
      mode: 'DEMO',
      upiVpa: null,
      merchantName: null,
      qrImageUrl: null,
      qrStorageKey: null,
      instructions: null,
      isActive: false,
      demoQr: {
        payload: `SERVE-DEMO:${listed.id}`,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        warning: 'DEMO ONLY — NOT PAYABLE',
      },
      qr: null,
      warnings: ['DEMO_MODE_ACTIVE'],
      updatedAt: '2026-10-06T18:00:00.000Z',
    });
    api.updatePaymentConfig.mockResolvedValue({
      canteenId: listed.id,
      mode: 'DEMO',
      upiVpa: 'vedavathi@okicici',
      merchantName: 'Vedavathi Night Canteen',
      qrImageUrl: 'https://cdn.example.com/qr.png',
      qrStorageKey: null,
      instructions: 'Pay and show the screenshot.',
      isActive: false,
      demoQr: {
        payload: `SERVE-DEMO:${listed.id}`,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        warning: 'DEMO ONLY — NOT PAYABLE',
      },
      qr: null,
      warnings: ['DEMO_MODE_ACTIVE'],
      updatedAt: '2026-10-06T18:00:00.000Z',
    });

    renderDetail(api, listed.id);
    expect(await screen.findByText(/Test mode is active/i)).toBeInTheDocument();
    expect(screen.getAllByText(/DEMO ONLY — NOT PAYABLE/).length).toBeGreaterThan(0);
    const paymentSection = screen.getByRole('heading', { name: 'UPI payments' }).closest('section');
    expect(paymentSection).toBeTruthy();
    await userEvent.click(within(paymentSection!).getByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByLabelText('UPI ID / VPA'), 'vedavathi@okicici');
    await userEvent.type(screen.getByLabelText('Merchant display name'), 'Vedavathi Night Canteen');
    await userEvent.click(screen.getByRole('button', { name: 'Save payment configuration' }));
    await waitFor(() =>
      expect(api.updatePaymentConfig).toHaveBeenCalledWith(
        listed.id,
        expect.objectContaining({ mode: 'DEMO', upiVpa: 'vedavathi@okicici', isActive: false }),
      ),
    );
  });
});
