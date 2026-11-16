import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MenuPage } from '../src/pages/MenuPage';
import { adminCanteen, fakeAdminApi, renderAdmin, uuid } from './fixtures';

const catalogue = (canteenId: string) => {
  const categoryId = uuid();
  const itemId = uuid();
  return [
    {
      id: categoryId,
      canteenId,
      name: 'Rolls',
      sortOrder: 0,
      isActive: true,
      updatedAt: '2026-10-06T18:00:00.000Z',
      items: [
        {
          id: itemId,
          canteenId,
          categoryId,
          name: 'Egg Roll',
          description: 'Street style',
          pricePaise: 4500,
          imageUrl: null,
          isAvailable: true,
          isActive: true,
          availability: 'AVAILABLE' as const,
          isOrderable: true,
          updatedAt: '2026-10-06T18:00:00.000Z',
          services: [
            { period: 'DAY' as const, pricePaise: 4000, isAvailable: true },
            { period: 'NIGHT' as const, pricePaise: 4500, isAvailable: false },
          ],
        },
      ],
    },
  ];
};

describe('menu management', () => {
  it('shows the price of the selected canteen’s own period', async () => {
    const api = fakeAdminApi();
    const night = adminCanteen('Vedavathi Night Canteen');
    const day = adminCanteen('Vedavathi Day Canteen');
    api.canteens.mockResolvedValue([night, day]);
    api.menuCatalogue.mockResolvedValue(catalogue(night.id));
    renderAdmin(<MenuPage />, { api });
    expect(await screen.findByText('Egg Roll')).toBeInTheDocument();
    const row = screen.getByText('Egg Roll').closest('tr')!;
    // Night canteen: the NIGHT price/availability only.
    expect(within(row).getByText('₹45')).toBeInTheDocument();
    expect(within(row).getByText('Off')).toBeInTheDocument();
    expect(within(row).queryByText('₹40')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Vedavathi Day Canteen · Day' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Day' })).not.toBeInTheDocument();
  });

  it('edits one price for the canteen’s own period', async () => {
    const api = fakeAdminApi();
    const canteen = adminCanteen('Vedavathi Night Canteen');
    const rows = catalogue(canteen.id);
    api.canteens.mockResolvedValue([canteen]);
    api.menuCatalogue.mockResolvedValue(rows);
    api.updateMenuItem.mockResolvedValue(rows[0]!.items[0]!);
    api.updateMenuItemServices.mockResolvedValue({
      id: rows[0]!.items[0]!.id,
      canteenId: canteen.id,
      name: 'Egg Roll',
      pricePaise: 5500,
      isAvailable: true,
      services: rows[0]!.items[0]!.services,
    });
    renderAdmin(<MenuPage />, { api });
    await screen.findByText('Egg Roll');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('Price (₹)'));
    await userEvent.type(within(dialog).getByLabelText('Price (₹)'), '55');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Available to order' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(api.updateMenuItemServices).toHaveBeenCalledWith(rows[0]!.items[0]!.id, [
      { period: 'NIGHT', pricePaise: 5500, isAvailable: true },
    ]);
  });

  it('shows an empty menu without inventing items', async () => {
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([adminCanteen('Vedavathi Night Canteen')]);
    api.menuCatalogue.mockResolvedValue([]);
    renderAdmin(<MenuPage />, { api });
    expect(await screen.findByText('No menu yet')).toBeInTheDocument();
  });
});
