import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { StaffPage } from '../src/pages/StaffPage';
import { adminCanteen, fakeAdminApi, renderAdmin, staffDetail, staffSummary } from './fixtures';

describe('staff assignments and capabilities', () => {
  it('saves explicit capabilities and does not grant cashier unless checked', async () => {
    const api = fakeAdminApi();
    const kg = adminCanteen('Krishna & Godavari Night Canteen');
    const ved = adminCanteen('Vedavathi Night Canteen');
    const s = staffSummary({ status: 'APPROVED', canteen: { id: kg.id, name: kg.name } });
    api.canteens.mockResolvedValue([kg, ved]);
    api.staff.mockResolvedValue({ data: [s], nextCursor: null });
    api.staffMember.mockResolvedValue(
      staffDetail(s, [], {
        assignments: [
          { canteenId: kg.id, canteen: { id: kg.id, name: kg.name }, capabilities: ['KITCHEN', 'MENU', 'PAUSE'] },
        ],
      }),
    );
    api.updateStaffAssignments.mockResolvedValue({
      ...s,
      canteenId: kg.id,
      assignments: [
        { canteenId: kg.id, canteen: { id: kg.id, name: kg.name }, capabilities: ['KITCHEN'] },
      ],
    });

    renderAdmin(<StaffPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Manage Priya Staff' }));
    const dialog = await screen.findByRole('dialog', { name: 'Priya Staff' });
    expect(within(dialog).getByText('Primary')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Cashier' })).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Menu' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Pause orders' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save assignments' }));
    await waitFor(() =>
      expect(api.updateStaffAssignments).toHaveBeenCalledWith(s.id, {
        primaryCanteenId: kg.id,
        assignments: [{ canteenId: kg.id, capabilities: ['KITCHEN'] }],
      }),
    );
  });

  it('can assign a second canteen without making cashier the default', async () => {
    const api = fakeAdminApi();
    const kg = adminCanteen('Krishna & Godavari Night Canteen');
    const ved = adminCanteen('Vedavathi Night Canteen');
    const s = staffSummary({ status: 'APPROVED', canteen: { id: kg.id, name: kg.name } });
    api.canteens.mockResolvedValue([kg, ved]);
    api.staff.mockResolvedValue({ data: [s], nextCursor: null });
    api.staffMember.mockResolvedValue(
      staffDetail(s, [], {
        assignments: [
          { canteenId: kg.id, canteen: { id: kg.id, name: kg.name }, capabilities: ['KITCHEN'] },
        ],
      }),
    );
    api.updateStaffAssignments.mockResolvedValue({
      ...s,
      canteenId: kg.id,
      assignments: [],
    });

    renderAdmin(<StaffPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Manage Priya Staff' }));
    const dialog = await screen.findByRole('dialog', { name: 'Priya Staff' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Add another canteen'), ved.id);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add canteen' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save assignments' }));
    await waitFor(() =>
      expect(api.updateStaffAssignments).toHaveBeenCalledWith(s.id, {
        primaryCanteenId: kg.id,
        assignments: [
          { canteenId: kg.id, capabilities: ['KITCHEN'] },
          { canteenId: ved.id, capabilities: [] },
        ],
      }),
    );
  });
});
