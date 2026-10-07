import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@serve/web-shared';
import { MenuPage, parsePrice } from '../src/pages/MenuPage';
import { category, fakeStaffApi, menuItem, renderStaff } from './fixtures';

describe('parsePrice', () => {
  it('converts rupees to integer paise within the backend range', () => {
    expect(parsePrice('120')).toEqual({ paise: 12_000 });
    expect(parsePrice('99.50')).toEqual({ paise: 9_950 });
    expect(parsePrice('0.50')).toEqual({ error: 'Price must be at least ₹1' });
    expect(parsePrice('10000.01')).toEqual({ error: 'Price must be at most ₹10,000' });
    expect(parsePrice('12.345')).toEqual({ error: 'Enter a price in rupees, e.g. 120 or 99.50' });
  });
});

describe('menu management', () => {
  it('lists categories and items with their availability', async () => {
    const api = fakeStaffApi();
    api.menu.mockResolvedValue([
      category('Dosas', [
        { name: 'Masala Dosa' },
        { name: 'Onion Dosa', isAvailable: false, availability: 'UNAVAILABLE', isOrderable: false },
      ]),
      category('Juices', [], { isActive: false }),
    ]);
    renderStaff(<MenuPage />, { api });
    const dosas = await screen.findByRole('region', { name: 'Dosas' });
    const onion = within(dosas).getByText('Onion Dosa').closest('tr')!;
    expect(within(onion).getByText('Unavailable')).toBeInTheDocument();
    expect(within(onion).getByRole('checkbox', { name: 'Onion Dosa available' })).not.toBeChecked();
    expect(
      within(screen.getByRole('region', { name: 'Juices' })).getByText('Hidden'),
    ).toBeInTheDocument();
  });

  it('creates an item, sending the rupee price as paise', async () => {
    const api = fakeStaffApi();
    const dosas = category('Dosas');
    api.menu.mockResolvedValue([dosas]);
    api.createItem.mockImplementation(async (body) =>
      menuItem({ ...body, description: body.description ?? null }),
    );
    renderStaff(<MenuPage />, { api });

    await userEvent.click(await screen.findByRole('button', { name: 'Add item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add menu item' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Ghee Roast');
    await userEvent.type(within(dialog).getByLabelText('Price (₹)'), '99.50');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));

    await waitFor(() =>
      expect(api.createItem).toHaveBeenCalledWith({
        categoryId: dosas.id,
        name: 'Ghee Roast',
        description: null,
        pricePaise: 9_950,
        isAvailable: true,
      }),
    );
    expect(await screen.findByText('Ghee Roast added')).toBeInTheDocument();
  });

  it('blocks an invalid price locally and never calls the API', async () => {
    const api = fakeStaffApi();
    api.menu.mockResolvedValue([category('Dosas')]);
    renderStaff(<MenuPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Add item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add menu item' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Tea');
    await userEvent.type(within(dialog).getByLabelText('Price (₹)'), 'ten');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    expect(
      within(dialog).getByText('Enter a price in rupees, e.g. 120 or 99.50'),
    ).toBeInTheDocument();
    expect(api.createItem).not.toHaveBeenCalled();
  });

  it('shows backend field errors (422) next to the field', async () => {
    const api = fakeStaffApi();
    api.menu.mockResolvedValue([category('Dosas')]);
    api.createItem.mockRejectedValue(
      new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', [
        { path: 'name', message: 'Must be at most 120 characters' },
      ]),
    );
    renderStaff(<MenuPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Add item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add menu item' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Tea');
    await userEvent.type(within(dialog).getByLabelText('Price (₹)'), '15');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    expect(await within(dialog).findByText('Must be at most 120 characters')).toBeInTheDocument();
  });

  it('edits an item price, pre-filled in rupees', async () => {
    const api = fakeStaffApi();
    const dosas = category('Dosas', [{ name: 'Masala Dosa', pricePaise: 6_050 }]);
    api.menu.mockResolvedValue([dosas]);
    api.updateItem.mockImplementation(
      async (id, body) => ({ ...dosas.items[0]!, id, ...body }) as never,
    );
    renderStaff(<MenuPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Masala Dosa' }));
    const price = within(screen.getByRole('dialog')).getByLabelText('Price (₹)');
    expect(price).toHaveValue('60.50');
    await userEvent.clear(price);
    await userEvent.type(price, '65');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(api.updateItem).toHaveBeenCalledWith(
        dosas.items[0]!.id,
        expect.objectContaining({ pricePaise: 6_500 }),
      ),
    );
  });

  it('toggles availability through the backend and shows the confirmed state', async () => {
    const api = fakeStaffApi();
    const dosas = category('Dosas', [{ name: 'Masala Dosa' }]);
    const item = dosas.items[0]!;
    api.menu.mockResolvedValue([dosas]);
    api.setAvailability.mockResolvedValue({
      ...item,
      isAvailable: false,
      availability: 'UNAVAILABLE',
      isOrderable: false,
    });
    renderStaff(<MenuPage />, { api });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Masala Dosa available' }));
    expect(api.setAvailability).toHaveBeenCalledWith(item.id, false);
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
  });

  it('disables and re-enables an item', async () => {
    const api = fakeStaffApi();
    const dosas = category('Dosas', [{ name: 'Masala Dosa' }]);
    const item = dosas.items[0]!;
    api.menu.mockResolvedValue([dosas]);
    api.disableItem.mockResolvedValue({
      ...item,
      isActive: false,
      availability: 'INACTIVE',
      isOrderable: false,
    });
    api.updateItem.mockResolvedValue(item);
    renderStaff(<MenuPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Disable' }));
    expect(api.disableItem).toHaveBeenCalledWith(item.id);
    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(api.updateItem).toHaveBeenCalledWith(item.id, { isActive: true });
  });

  it('reloads when a colleague changes the menu (realtime)', async () => {
    const api = fakeStaffApi();
    const dosas = category('Dosas', [{ name: 'Masala Dosa' }]);
    api.menu.mockResolvedValue([dosas]);
    const { fake } = renderStaff(<MenuPage />, { api });
    await screen.findByText('Masala Dosa');
    const item = dosas.items[0]!;
    act(() =>
      fake.serverEmit('menu.item_price_changed', {
        itemId: item.id,
        canteenId: item.canteenId,
        pricePaise: 7_000,
        previousPricePaise: 6_000,
      }),
    );
    await waitFor(() => expect(api.menu).toHaveBeenCalledTimes(2));
  });

  it('creates a category', async () => {
    const api = fakeStaffApi();
    api.menu.mockResolvedValue([]);
    api.createCategory.mockResolvedValue({ ...category('Rolls'), items: undefined } as never);
    renderStaff(<MenuPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = screen.getByRole('dialog', { name: 'Add category' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Rolls');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add category' }));
    await waitFor(() =>
      expect(api.createCategory).toHaveBeenCalledWith({ name: 'Rolls', sortOrder: 0 }),
    );
  });
});
