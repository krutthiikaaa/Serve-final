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

  it('creates a missing DAY service through the admin services API', async () => {
    const api = fakeAdminApi();
    const listed = adminCanteen('Vedavathi Night Canteen');
    api.canteen.mockResolvedValue(adminCanteenDetail(listed));
    api.liveCanteen.mockResolvedValue(publicCanteen(listed));
    api.menuCatalogue.mockResolvedValue([]);
    api.paymentConfig.mockResolvedValue(null);
    api.updateCanteenServices.mockResolvedValue({
      ...listed,
      services: [],
      configurationWarnings: [],
    });

    renderDetail(api, listed.id);
    await userEvent.click(
      within(await screen.findByRole('tablist', { name: 'Service period' })).getByRole('tab', {
        name: /Day/,
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Add Day service' }));
    expect(api.updateCanteenServices).toHaveBeenCalledWith(listed.id, [
      { period: 'DAY', isEnabled: true, override: 'AUTO' },
    ]);
  });
});

describe('menu service pricing', () => {
  it('shows unconfigured period prices and saves DAY without changing NIGHT unless typed', async () => {
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
            services: [{ period: 'NIGHT', pricePaise: 4500, isAvailable: true }],
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
      services: [
        { period: 'DAY', pricePaise: 4000, isAvailable: true },
        { period: 'NIGHT', pricePaise: 4500, isAvailable: true },
      ],
    });

    renderDetail(api, listed.id);
    await userEvent.click(
      within(await screen.findByRole('tablist', { name: 'Price period' })).getByRole('tab', {
        name: 'Day',
      }),
    );
    expect(await screen.findByText('Not configured')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set prices' }));
    const dialog = screen.getByRole('dialog', { name: 'Prices for Egg Roll' });
    await userEvent.type(within(dialog).getByLabelText('Day price (₹)'), '40');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save prices' }));
    await waitFor(() =>
      expect(api.updateMenuItemServices).toHaveBeenCalledWith(itemId, [
        { period: 'DAY', pricePaise: 4000, isAvailable: true },
        { period: 'NIGHT', pricePaise: 4500, isAvailable: true },
      ]),
    );
  });

  it('shows DAY and NIGHT prices for inactive items instead of Not configured', async () => {
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
    await userEvent.click(
      within(screen.getByRole('tablist', { name: 'Price period' })).getByRole('tab', {
        name: 'Day',
      }),
    );
    expect(await screen.findByText('₹30')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
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
      warnings: ['DEMO_MODE_ACTIVE'],
      updatedAt: '2026-10-06T18:00:00.000Z',
    });

    renderDetail(api, listed.id);
    expect(await screen.findByText(/DEMO mode is active/i)).toBeInTheDocument();
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
