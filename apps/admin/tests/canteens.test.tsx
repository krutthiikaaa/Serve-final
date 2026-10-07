import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CanteensPage } from '../src/pages/CanteensPage';
import { adminCanteen, fakeAdminApi, renderAdmin } from './fixtures';

const row = (name: string) => screen.getByRole('link', { name }).closest('tr')!;

describe('canteens', () => {
  it('lists canteens with their status and counts', async () => {
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([
      adminCanteen('Vedavathi Night Canteen'),
      adminCanteen('New Hostel Night Canteen', { isAcceptingOrders: false, status: 'PAUSED' }),
      adminCanteen('Old Canteen', {
        isActive: false,
        isAcceptingOrders: false,
        status: 'INACTIVE',
      }),
    ]);
    renderAdmin(<CanteensPage />, { api });
    await screen.findByText('Vedavathi Night Canteen');
    expect(
      within(row('Vedavathi Night Canteen')).getByText('Accepting orders'),
    ).toBeInTheDocument();
    expect(
      within(row('New Hostel Night Canteen')).getByRole('button', { name: 'Resume' }),
    ).toBeInTheDocument();
    expect(
      within(row('Old Canteen')).getByRole('button', { name: 'Activate' }),
    ).toBeInTheDocument();
  });

  it('pauses order-taking', async () => {
    const api = fakeAdminApi();
    const c = adminCanteen('Vedavathi Night Canteen');
    api.canteens
      .mockResolvedValueOnce([c])
      .mockResolvedValue([{ ...c, isAcceptingOrders: false, status: 'PAUSED' }]);
    api.updateCanteen.mockResolvedValue({ ...c, isAcceptingOrders: false, status: 'PAUSED' });
    renderAdmin(<CanteensPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(api.updateCanteen).toHaveBeenCalledWith(c.id, { isAcceptingOrders: false });
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('asks for confirmation before deactivating', async () => {
    const api = fakeAdminApi();
    const c = adminCanteen('Vedavathi Night Canteen');
    api.canteens.mockResolvedValue([c]);
    api.updateCanteen.mockResolvedValue({ ...c, isActive: false, status: 'INACTIVE' });
    renderAdmin(<CanteensPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect(api.updateCanteen).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Vedavathi Night Canteen?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(api.updateCanteen).toHaveBeenCalledWith(c.id, { isActive: false });
  });

  it('creates a canteen', async () => {
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([]);
    api.createCanteen.mockImplementation(async (body) => ({ ...adminCanteen(body.name) }));
    renderAdmin(<CanteensPage />, { api });
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add canteen' }))[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Add canteen' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Saraswati Night Canteen');
    await userEvent.type(within(dialog).getByLabelText('Location'), 'Near Saraswati block');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add canteen' }));
    await waitFor(() =>
      expect(api.createCanteen).toHaveBeenCalledWith({
        name: 'Saraswati Night Canteen',
        location: 'Near Saraswati block',
        openingHours: null,
      }),
    );
  });

  it('validates the slug locally', async () => {
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([]);
    renderAdmin(<CanteensPage />, { api });
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add canteen' }))[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Add canteen' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'X');
    await userEvent.type(within(dialog).getByLabelText('Slug (optional)'), 'Bad Slug');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add canteen' }));
    expect(
      within(dialog).getByText('Use lowercase letters, digits and hyphens'),
    ).toBeInTheDocument();
    expect(api.createCanteen).not.toHaveBeenCalled();
  });
});
