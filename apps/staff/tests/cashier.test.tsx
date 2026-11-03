import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CanteenPaymentConfig, Menu } from '@serve/contracts';
import { CashierPage } from '../src/pages/CashierPage';
import {
  CANTEEN_ID,
  canteen,
  category,
  fakeStaffApi,
  meStaff,
  order,
  renderStaff,
} from './fixtures';

const cashierMe = () =>
  meStaff({
    assignments: [
      {
        canteenId: CANTEEN_ID,
        canteen: { id: CANTEEN_ID, name: canteen.name, isActive: true, isAcceptingOrders: true },
        capabilities: ['CASHIER'],
      },
    ],
  });

const demoPayConfig: CanteenPaymentConfig = {
  canteenId: CANTEEN_ID,
  mode: 'DEMO',
  upiVpa: null,
  merchantName: null,
  qrImageUrl: null,
  instructions: null,
  isActive: false,
  demoQr: {
    payload: `SERVE-DEMO:${CANTEEN_ID}`,
    svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    warning: 'DEMO ONLY — NOT PAYABLE',
  },
  warnings: ['DEMO_MODE_ACTIVE'],
  updatedAt: '2026-10-06T18:00:00.000Z',
};

const livePayConfig = {
  ...demoPayConfig,
  mode: 'LIVE' as const,
  upiVpa: 'serve-test@okaxis',
  merchantName: 'Test merchant',
  qrImageUrl: 'https://cdn.example.com/official-qr.png',
  demoQr: null,
  warnings: [],
  isActive: true,
};

const posCanteen: Menu['canteen'] = {
  ...canteen,
  supportedPeriods: ['DAY', 'NIGHT'],
  services: [
    { period: 'DAY', isEnabled: true, override: 'FORCE_OPEN', isOpenNow: true },
    { period: 'NIGHT', isEnabled: true, override: 'FORCE_OPEN', isOpenNow: true },
  ],
  configurationWarnings: [],
};

function stubCashier(api: ReturnType<typeof fakeStaffApi>, payConfig: CanteenPaymentConfig = demoPayConfig) {
  api.pendingPayments.mockResolvedValue({ data: [], nextCursor: null });
  api.paymentConfig.mockResolvedValue(payConfig);
  api.sales.mockResolvedValue({ data: [], nextCursor: null });
  api.posMenu.mockImplementation(async (period) => {
    if (period === 'DAY') {
      return {
        canteen: posCanteen,
        servicePeriod: 'DAY',
        categories: [
          category('Breakfast', [{ name: 'Idli', pricePaise: 4_000 }]),
          category('Empty day', []),
        ],
      };
    }
    return {
      canteen: posCanteen,
      servicePeriod: 'NIGHT',
      categories: [
        category('Snacks', [{ name: 'Veg Sandwich', pricePaise: 6_000 }]),
        category('Beverages', [
          { name: 'Hot Tea', pricePaise: 2_000 },
          { name: 'Filter Coffee', pricePaise: 2_500, isAvailable: false, availability: 'UNAVAILABLE', isOrderable: false },
        ]),
        category('Empty night', []),
      ],
    };
  });
}

describe('cashier workflows', () => {
  it('confirms a pending app payment only after an explicit verification', async () => {
    const api = fakeStaffApi();
    const pending = order('PLACED', {
      paidAt: null,
      payment: {
        provider: 'MOCK',
        status: 'PENDING',
        amountPaise: 12_000,
        currency: 'INR',
        utr: 'AXIS123',
        verifiedAt: null,
        paidAt: null,
        refundedAt: null,
        failureReason: null,
        isSimulated: false,
      },
      timeline: [{ status: 'PLACED', at: '2026-10-06T19:00:00.000Z' }],
    });
    api.pendingPayments.mockResolvedValue({ data: [pending], nextCursor: null });
    api.paymentConfig.mockResolvedValue({
      canteenId: CANTEEN_ID,
      mode: 'DEMO',
      upiVpa: null,
      merchantName: null,
      qrImageUrl: null,
      instructions: null,
      isActive: false,
      demoQr: {
        payload: `SERVE-DEMO:${CANTEEN_ID}`,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        warning: 'DEMO ONLY — NOT PAYABLE',
      },
      warnings: ['DEMO_MODE_ACTIVE'],
      updatedAt: '2026-10-06T18:00:00.000Z',
    });
    api.confirmDemoPayment.mockResolvedValue({
      order: { ...pending, status: 'PAYMENT_CONFIRMED', receiptNumber: 'RC1001' },
      receipt: {
        receiptNumber: 'RC1001',
        orderNumber: pending.orderNumber,
        pickupToken: pending.orderNumber,
        channel: 'APP',
        universityName: 'Vellore Institute of Technology',
        canteen: pending.canteen,
        createdAt: pending.createdAt,
        paidAt: pending.createdAt,
        servicePeriod: 'NIGHT',
        items: pending.items.map((item) => ({
          itemName: item.itemName,
          quantity: item.quantity,
          unitPricePaise: item.unitPricePaise,
          lineTotalPaise: item.lineTotalPaise,
        })),
        totalPaise: pending.totalPaise,
        currency: 'INR',
        paymentMethod: 'UPI',
        paymentStatus: 'SUCCESS',
        utr: 'AXIS123',
        studentName: pending.student?.name ?? null,
        guestName: null,
        verifiedByName: 'Kiran Staff',
        simulated: true,
        notice: 'DEMO TRANSACTION — NO REAL PAYMENT',
      },
    });
    renderStaff(<CashierPage />, { api, me: cashierMe() });
    expect(await screen.findByText(pending.orderNumber)).toBeInTheDocument();
    expect(await screen.findAllByText(/DEMO mode/i)).not.toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Simulate' }));
    await userEvent.click(screen.getByRole('button', { name: 'Simulate payment received' }));
    await waitFor(() =>
      expect(api.confirmDemoPayment).toHaveBeenCalledWith(pending.id, {
        simulatedPaymentReceived: true,
        utr: 'AXIS123',
      }),
    );
    expect(api.confirmPayment).not.toHaveBeenCalled();
    expect(await screen.findByText('RC1001')).toBeInTheDocument();
    expect(screen.getByText('DEMO TRANSACTION — NO REAL PAYMENT')).toBeInTheDocument();
  });

  it('walk-in POS has no QR, updates the total, and records a DEMO cash sale', async () => {
    const api = fakeStaffApi();
    stubCashier(api);
    api.completeDemoWalkIn.mockResolvedValue({
      order: order('PAYMENT_CONFIRMED', { channel: 'WALK_IN', guestName: null }),
      receipt: {
        receiptNumber: 'RC2001',
        orderNumber: 'SV2001',
        pickupToken: 'SV2001',
        channel: 'WALK_IN',
        universityName: 'Vellore Institute of Technology',
        canteen: { id: CANTEEN_ID, name: canteen.name },
        createdAt: '2026-10-06T19:00:00.000Z',
        paidAt: '2026-10-06T19:00:00.000Z',
        servicePeriod: 'NIGHT',
        items: [{ itemName: 'Veg Sandwich', quantity: 2, unitPricePaise: 6_000, lineTotalPaise: 12_000 }],
        totalPaise: 12_000,
        currency: 'INR',
        paymentMethod: 'CASH',
        paymentStatus: 'SUCCESS',
        utr: null,
        studentName: null,
        guestName: null,
        verifiedByName: 'Kiran Staff',
        simulated: true,
        notice: 'DEMO TRANSACTION — NO REAL PAYMENT',
      },
    });
    renderStaff(<CashierPage />, { api, me: cashierMe() });
    await userEvent.click(await screen.findByRole('tab', { name: 'Walk-in POS' }));
    expect(await screen.findByRole('heading', { name: 'Current Bill' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete bill' })).toBeDisabled();
    expect(screen.queryByRole('radio', { name: 'Cash' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Ask the customer to scan the QR displayed separately/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('DEMO TRANSACTION — NO REAL PAYMENT')).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Add Veg Sandwich' }));
    expect(screen.getByText('DEMO TRANSACTION — NO REAL PAYMENT')).toBeInTheDocument();
    const total = () => screen.getByText('Estimated total').closest('.pos-bill-total');
    expect(total()).toHaveTextContent('₹60');
    await userEvent.click(screen.getByRole('button', { name: 'Increase Veg Sandwich' }));
    expect(total()).toHaveTextContent('₹120');
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Veg Sandwich' }));
    expect(total()).toHaveTextContent('₹60');
    expect(screen.getByRole('radio', { name: 'Cash' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Complete bill' }));
    await userEvent.click(screen.getByRole('button', { name: 'Simulate payment received' }));
    await waitFor(() =>
      expect(api.completeDemoWalkIn).toHaveBeenCalledWith({
        servicePeriod: 'NIGHT',
        paymentMethod: 'CASH',
        simulatedPaymentReceived: true,
        guestName: null,
        utr: null,
        items: [{ menuItemId: expect.any(String), quantity: 1 }],
      }),
    );
    expect(api.completeWalkIn).not.toHaveBeenCalled();
  });

  it('shows UPI counter instructions without a QR image', async () => {
    const api = fakeStaffApi();
    stubCashier(api);
    renderStaff(<CashierPage />, { api, me: cashierMe() });
    await userEvent.click(await screen.findByRole('tab', { name: 'Walk-in POS' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Veg Sandwich' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'UPI' }));
    expect(
      screen.getByText(
        'Ask the customer to scan the QR displayed separately at the counter. Verify the payment in the merchant account before confirming.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByAltText('DEMO ONLY — NOT PAYABLE')).not.toBeInTheDocument();
    expect(screen.getByText('DEMO TRANSACTION — NO REAL PAYMENT')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Cash' }));
    expect(
      screen.queryByText(/Ask the customer to scan the QR displayed separately/),
    ).not.toBeInTheDocument();
  });

  it('LIVE walk-in UPI still requires explicit credit verification', async () => {
    const api = fakeStaffApi();
    stubCashier(api, livePayConfig);
    api.completeWalkIn.mockResolvedValue({
      order: order('PAYMENT_CONFIRMED', { channel: 'WALK_IN' }),
      receipt: {
        receiptNumber: 'RC2002',
        orderNumber: 'SV2002',
        pickupToken: 'SV2002',
        channel: 'WALK_IN',
        universityName: 'Vellore Institute of Technology',
        canteen: { id: CANTEEN_ID, name: canteen.name },
        createdAt: '2026-10-06T19:00:00.000Z',
        paidAt: '2026-10-06T19:00:00.000Z',
        servicePeriod: 'NIGHT',
        items: [{ itemName: 'Veg Sandwich', quantity: 1, unitPricePaise: 6_000, lineTotalPaise: 6_000 }],
        totalPaise: 6_000,
        currency: 'INR',
        paymentMethod: 'UPI',
        paymentStatus: 'SUCCESS',
        utr: null,
        studentName: null,
        guestName: null,
        verifiedByName: 'Kiran Staff',
        simulated: false,
        notice: null,
      },
    });
    renderStaff(<CashierPage />, { api, me: cashierMe() });
    await userEvent.click(await screen.findByRole('tab', { name: 'Walk-in POS' }));
    expect(await screen.findByText('LIVE')).toBeInTheDocument();
    expect(screen.queryByText('DEMO TRANSACTION — NO REAL PAYMENT')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Add Veg Sandwich' }));
    await userEvent.click(screen.getByRole('radio', { name: 'UPI' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('serve-test@okaxis')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Complete bill' }));
    expect(screen.getByText(/Confirm only after the credit appears on the merchant account/)).toBeInTheDocument();
    expect(api.completeWalkIn).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'UPI credit verified' }));
    await waitFor(() =>
      expect(api.completeWalkIn).toHaveBeenCalledWith({
        servicePeriod: 'NIGHT',
        paymentMethod: 'UPI',
        paymentReceived: true,
        guestName: null,
        utr: null,
        items: [{ menuItemId: expect.any(String), quantity: 1 }],
      }),
    );
    expect(api.completeDemoWalkIn).not.toHaveBeenCalled();
  });

  it('filters the POS menu by category and service period', async () => {
    const api = fakeStaffApi();
    stubCashier(api);
    renderStaff(<CashierPage />, { api, me: cashierMe() });
    await userEvent.click(await screen.findByRole('tab', { name: 'Walk-in POS' }));

    const categories = await screen.findByRole('toolbar', { name: 'Menu categories' });
    expect(within(categories).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(categories).getByRole('button', { name: 'Snacks' })).toBeInTheDocument();
    expect(within(categories).getByRole('button', { name: 'Beverages' })).toBeInTheDocument();
    expect(within(categories).queryByRole('button', { name: 'Empty night' })).not.toBeInTheDocument();
    expect(screen.getByText('Veg Sandwich')).toBeInTheDocument();
    expect(screen.getByText('Hot Tea')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Filter Coffee' })).toBeDisabled();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();

    await userEvent.click(within(categories).getByRole('button', { name: 'Beverages' }));
    expect(screen.queryByText('Veg Sandwich')).not.toBeInTheDocument();
    expect(screen.getByText('Hot Tea')).toBeInTheDocument();
    await userEvent.click(within(categories).getByRole('button', { name: 'All' }));
    expect(screen.getByText('Veg Sandwich')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add Veg Sandwich' }));
    expect(screen.getByText('Estimated total').closest('.pos-bill-total')).toHaveTextContent('₹60');

    await userEvent.click(screen.getByRole('tab', { name: 'Day' }));
    expect(await screen.findByText('Idli')).toBeInTheDocument();
    expect(screen.queryByText('Veg Sandwich')).not.toBeInTheDocument();
    expect(screen.queryByText('Snacks')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Breakfast' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete bill' })).toBeDisabled();
    expect(api.posMenu).toHaveBeenCalledWith('DAY');
  });

  it('lists billing history with compact filters and essential columns', async () => {
    const api = fakeStaffApi();
    stubCashier(api);
    const walkIn = order('PAYMENT_CONFIRMED', {
      channel: 'WALK_IN',
      receiptNumber: 'RC4101',
      guestName: 'Campus guest',
      student: null,
      servicePeriod: 'NIGHT',
      payment: {
        provider: 'CASH',
        status: 'SUCCESS',
        amountPaise: 12_000,
        currency: 'INR',
        utr: null,
        verifiedAt: '2026-10-06T19:00:00.000Z',
        paidAt: '2026-10-06T19:00:00.000Z',
        refundedAt: null,
        failureReason: null,
        isSimulated: false,
      },
    });
    const appSale = order('PAYMENT_CONFIRMED', {
      channel: 'APP',
      receiptNumber: 'RC4102',
      servicePeriod: 'DAY',
      payment: {
        provider: 'UPI',
        status: 'SUCCESS',
        amountPaise: 12_000,
        currency: 'INR',
        utr: 'AXIS999',
        verifiedAt: '2026-10-06T12:00:00.000Z',
        paidAt: '2026-10-06T12:00:00.000Z',
        refundedAt: null,
        failureReason: null,
        isSimulated: true,
      },
    });
    api.sales.mockResolvedValue({ data: [walkIn, appSale], nextCursor: null });
    api.receipt.mockResolvedValue({
      receiptNumber: 'RC4101',
      orderNumber: walkIn.orderNumber,
      pickupToken: walkIn.orderNumber,
      channel: 'WALK_IN',
      universityName: 'Vellore Institute of Technology',
      canteen: walkIn.canteen,
      createdAt: walkIn.createdAt,
      paidAt: walkIn.paidAt ?? walkIn.createdAt,
      servicePeriod: 'NIGHT',
      items: walkIn.items.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        unitPricePaise: item.unitPricePaise,
        lineTotalPaise: item.lineTotalPaise,
      })),
      totalPaise: walkIn.totalPaise,
      currency: 'INR',
      paymentMethod: 'CASH',
      paymentStatus: 'SUCCESS',
      utr: null,
      studentName: null,
      guestName: 'Campus guest',
      verifiedByName: 'Kiran Staff',
      simulated: false,
      notice: null,
    });
    renderStaff(<CashierPage />, { api, me: cashierMe() });
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }));

    expect(await screen.findByRole('heading', { name: 'Billing history' })).toBeInTheDocument();
    expect(screen.getByLabelText('Channel')).toHaveDisplayValue('All channels');
    expect(screen.getByLabelText('Payment method')).toHaveDisplayValue('All methods');
    expect(screen.getByLabelText('Service period')).toHaveDisplayValue('All periods');
    expect(screen.getByLabelText('Payment mode')).toHaveDisplayValue('All modes');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled();

    const walkInRow = screen.getByText('RC4101').closest('tr');
    const appRow = screen.getByText('RC4102').closest('tr');
    expect(walkInRow).toHaveTextContent('Walk-in');
    expect(walkInRow).toHaveTextContent('Night');
    expect(walkInRow).toHaveTextContent('Cash');
    expect(walkInRow).toHaveTextContent('LIVE');
    expect(appRow).toHaveTextContent('App');
    expect(appRow).toHaveTextContent('Day');
    expect(appRow).toHaveTextContent('UPI');
    expect(appRow).toHaveTextContent('DEMO');

    await userEvent.selectOptions(screen.getByLabelText('Channel'), 'WALK_IN');
    await userEvent.selectOptions(screen.getByLabelText('Payment method'), 'CASH');
    await userEvent.selectOptions(screen.getByLabelText('Service period'), 'NIGHT');
    await userEvent.selectOptions(screen.getByLabelText('Payment mode'), 'false');
    await waitFor(() =>
      expect(api.sales).toHaveBeenCalledWith({
        channel: 'WALK_IN',
        method: 'CASH',
        period: 'NIGHT',
        simulated: false,
        from: undefined,
        to: undefined,
      }),
    );

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-10' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-01' } });
    expect(await screen.findByText('Start date cannot be after end date.')).toBeInTheDocument();
    expect(screen.getByText('Invalid date range')).toBeInTheDocument();
    expect(
      api.sales.mock.calls.every((call) => {
        const from = call[0]?.from;
        const to = call[0]?.to;
        return !from || !to || from <= to;
      }),
    ).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(api.sales).toHaveBeenLastCalledWith({
        channel: undefined,
        method: undefined,
        period: undefined,
        simulated: undefined,
        from: undefined,
        to: undefined,
      }),
    );
    expect(screen.getByLabelText('Channel')).toHaveDisplayValue('All channels');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled();

    const row = (await screen.findByText('RC4101')).closest('tr');
    await userEvent.click(within(row!).getByRole('button', { name: 'Receipt' }));
    expect(await screen.findByText('Receipt RC4101')).toBeInTheDocument();
  });

  it('keeps billing filters visible for empty and failed history requests', async () => {
    const api = fakeStaffApi();
    stubCashier(api);
    api.sales.mockResolvedValue({ data: [], nextCursor: null });
    renderStaff(<CashierPage />, { api, me: cashierMe() });
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }));
    expect(await screen.findByText('No matching transactions')).toBeInTheDocument();
    expect(screen.getByLabelText('Channel')).toBeInTheDocument();

    api.sales.mockRejectedValue(new Error('Sales lookup failed'));
    await userEvent.selectOptions(screen.getByLabelText('Channel'), 'APP');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByLabelText('Payment method')).toBeInTheDocument();
  });
});
