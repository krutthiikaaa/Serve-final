import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { StaffPage } from '../src/pages/StaffPage';
import {
  adminCanteen,
  fakeAdminApi,
  renderAdmin,
  staffDetail,
  staffSummary,
  uuid,
} from './fixtures';

describe('staff management', () => {
  it('filters by status through the backend', async () => {
    const api = fakeAdminApi();
    api.canteens.mockResolvedValue([]);
    api.staff.mockResolvedValue({ data: [staffSummary()], nextCursor: null });
    renderAdmin(<StaffPage />, { api });
    await screen.findByText('Priya Staff');
    await userEvent.click(screen.getByRole('tab', { name: 'Pending' }));
    await waitFor(() =>
      expect(api.staff).toHaveBeenLastCalledWith({ status: 'PENDING', canteenId: undefined }),
    );
  });

  it('approves a pending request from the staff detail', async () => {
    const api = fakeAdminApi();
    const s = staffSummary();
    const requestId = uuid();
    api.canteens.mockResolvedValue([adminCanteen('Vedavathi Night Canteen')]);
    api.staff.mockResolvedValue({ data: [s], nextCursor: null });
    api.staffMember.mockResolvedValue(
      staffDetail(s, [
        {
          id: requestId,
          status: 'PENDING',
          notes: null,
          reviewNotes: null,
          reviewedAt: null,
          createdAt: s.createdAt,
          requestedCanteen: { id: uuid(), name: 'Vedavathi Night Canteen' },
          fromCanteen: null,
        },
      ]),
    );
    api.approveRequest.mockResolvedValue({} as never);
    renderAdmin(<StaffPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Manage Priya Staff' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve request' }));
    expect(api.approveRequest).toHaveBeenCalledWith(requestId);
  });

  it('reassigns an approved staff member to another active canteen', async () => {
    const api = fakeAdminApi();
    const current = adminCanteen('Krishna & Godavari Night Canteen');
    const target = adminCanteen('Vedavathi Night Canteen');
    const inactive = adminCanteen('Closed Canteen', { isActive: false, status: 'INACTIVE' });
    const s = staffSummary({ status: 'APPROVED', canteen: { id: current.id, name: current.name } });
    api.canteens.mockResolvedValue([current, target, inactive]);
    api.staff.mockResolvedValue({ data: [s], nextCursor: null });
    api.staffMember.mockResolvedValue(staffDetail(s));
    api.assignStaff.mockResolvedValue({ ...s, canteen: { id: target.id, name: target.name } });
    renderAdmin(<StaffPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Manage Priya Staff' }));
    const dialog = await screen.findByRole('dialog', { name: 'Priya Staff' });
    const select = within(dialog).getByLabelText('Move to canteen');
    // Only active canteens other than the current one are offered.
    expect(within(select).queryByText('Closed Canteen')).not.toBeInTheDocument();
    expect(within(select).queryByText(current.name)).not.toBeInTheDocument();
    await userEvent.selectOptions(select, target.id);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }));
    expect(api.assignStaff).toHaveBeenCalledWith(s.id, target.id);
    expect(await screen.findByText(`Priya Staff assigned to ${target.name}`)).toBeInTheDocument();
  });

  it('deactivates only after confirmation', async () => {
    const api = fakeAdminApi();
    const s = staffSummary({ status: 'APPROVED' });
    api.canteens.mockResolvedValue([]);
    api.staff.mockResolvedValue({ data: [s], nextCursor: null });
    api.staffMember.mockResolvedValue(staffDetail(s));
    api.deactivateStaff.mockResolvedValue({ ...s, status: 'DEACTIVATED' });
    renderAdmin(<StaffPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Manage Priya Staff' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate staff member' }));
    expect(api.deactivateStaff).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    expect(api.deactivateStaff).toHaveBeenCalledWith(s.id);
  });
});
