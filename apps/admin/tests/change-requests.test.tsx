import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@serve/web-shared';
import { ChangeRequestsPage } from '../src/pages/ChangeRequestsPage';
import { changeRequest, fakeAdminApi, renderAdmin } from './fixtures';

describe('change requests', () => {
  it('lists pending requests', async () => {
    const api = fakeAdminApi();
    const access = changeRequest();
    const move = changeRequest({
      staff: {
        id: '00000000-0000-4000-8000-0000000000aa',
        name: 'Ravi Staff',
        email: 'ravi@serve.dev',
        status: 'APPROVED',
      },
      fromCanteen: { id: '00000000-0000-4000-8000-0000000000ab', name: 'Ganga Night Canteen' },
    });
    api.changeRequests.mockResolvedValue({ data: [access, move], nextCursor: null });
    renderAdmin(<ChangeRequestsPage />, { api });
    expect(await screen.findByText('Priya Staff')).toBeInTheDocument();
    expect(screen.getByText('Ganga Night Canteen')).toBeInTheDocument();
    expect(api.changeRequests).toHaveBeenCalledWith('PENDING');
  });

  it('approves with a note and removes the request from the pending list', async () => {
    const api = fakeAdminApi();
    const r = changeRequest();
    api.changeRequests.mockResolvedValue({ data: [r], nextCursor: null });
    api.approveRequest.mockResolvedValue({
      ...r,
      status: 'APPROVED',
      reviewNotes: 'Welcome aboard',
    });
    renderAdmin(<ChangeRequestsPage />, { api });

    await userEvent.click(await screen.findByRole('button', { name: 'Approve Priya Staff' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve Priya Staff?' });
    await userEvent.type(
      within(dialog).getByLabelText('Note to the staff member (optional)'),
      'Welcome aboard',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and assign' }));

    expect(api.approveRequest).toHaveBeenCalledWith(r.id, 'Welcome aboard');
    expect(
      await screen.findByText('Priya Staff assigned to Vedavathi Night Canteen'),
    ).toBeInTheDocument();
    expect(screen.getByText('No pending requests')).toBeInTheDocument();
  });

  it('rejects without a note', async () => {
    const api = fakeAdminApi();
    const r = changeRequest();
    api.changeRequests.mockResolvedValue({ data: [r], nextCursor: null });
    api.rejectRequest.mockResolvedValue({ ...r, status: 'REJECTED' });
    renderAdmin(<ChangeRequestsPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Reject Priya Staff' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Reject request' }),
    );
    expect(api.rejectRequest).toHaveBeenCalledWith(r.id, undefined);
  });

  it('keeps the dialog open and shows the conflict when another admin already reviewed it', async () => {
    const api = fakeAdminApi();
    const r = changeRequest();
    api.changeRequests.mockResolvedValue({ data: [r], nextCursor: null });
    api.approveRequest.mockRejectedValue(
      new ApiError(
        409,
        'CHANGE_REQUEST_ALREADY_REVIEWED',
        'This request has already been reviewed.',
      ),
    );
    renderAdmin(<ChangeRequestsPage />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Approve Priya Staff' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve and assign' }),
    );
    expect(
      await within(screen.getByRole('dialog')).findByText(
        'This request has already been reviewed.',
      ),
    ).toBeInTheDocument();
  });

  it('shows new requests instantly and drops ones reviewed elsewhere', async () => {
    const api = fakeAdminApi();
    api.changeRequests.mockResolvedValue({ data: [], nextCursor: null });
    const { fake } = renderAdmin(<ChangeRequestsPage />, { api });
    await screen.findByText('No pending requests');

    const incoming = changeRequest();
    act(() => fake.serverEmit('change_request.created', { changeRequest: incoming }));
    expect(screen.getByText('Priya Staff')).toBeInTheDocument();
    expect(screen.getByText('New request from Priya Staff')).toBeInTheDocument();

    act(() =>
      fake.serverEmit('change_request.updated', {
        changeRequest: { ...incoming, status: 'APPROVED' },
      }),
    );
    expect(screen.getByText('No pending requests')).toBeInTheDocument();
  });

  it('switches to reviewed requests', async () => {
    const api = fakeAdminApi();
    api.changeRequests.mockImplementation(async (status) => ({
      data:
        status === 'APPROVED'
          ? [
              changeRequest({
                status: 'APPROVED',
                reviewNotes: 'Welcome',
                reviewedBy: { id: '00000000-0000-4000-8000-0000000000ff', name: 'Dev Admin' },
                reviewedAt: '2026-10-06T18:30:00.000Z',
              }),
            ]
          : [],
      nextCursor: null,
    }));
    renderAdmin(<ChangeRequestsPage />, { api });
    await screen.findByText('No pending requests');
    await userEvent.click(screen.getByRole('tab', { name: 'Approved' }));
    expect(await screen.findByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('by Dev Admin')).toBeInTheDocument();
    await waitFor(() => expect(api.changeRequests).toHaveBeenCalledWith('APPROVED'));
  });
});
