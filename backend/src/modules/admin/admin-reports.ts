import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ValidationError } from '../../lib/errors.js';
import { IST_OFFSET_MS, fromIst, startOfIstDay } from '../../lib/time.js';
import { officialDetailsReady } from '../canteens/payment-config.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 93;

export interface AdminReportQuery {
  from?: string | undefined;
  to?: string | undefined;
  canteenId?: string | undefined;
  servicePeriod?: 'DAY' | 'NIGHT' | undefined;
  channel?: 'APP' | 'WALK_IN' | undefined;
  paymentMethod?: 'CASH' | 'UPI' | undefined;
  paymentMode?: 'DEMO' | 'LIVE' | undefined;
}

function formatIstDate(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

function parseIstDay(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ValidationError('Use a YYYY-MM-DD date.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = fromIst({ year, month, day });
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  if (
    shifted.getUTCFullYear() !== year ||
    shifted.getUTCMonth() + 1 !== month ||
    shifted.getUTCDate() !== day
  ) {
    throw new ValidationError('Use a real calendar date.');
  }
  return date;
}

function resolveRange(query: AdminReportQuery) {
  const todayStart = startOfIstDay();
  const from = query.from ? parseIstDay(query.from) : new Date(todayStart.getTime() - 6 * DAY_MS);
  const toStart = query.to ? parseIstDay(query.to) : todayStart;
  const toExclusive = new Date(toStart.getTime() + DAY_MS);
  if (toExclusive.getTime() <= from.getTime()) {
    throw new ValidationError('The end date must be on or after the start date.');
  }
  if (toExclusive.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new ValidationError(`Choose a range of ${MAX_RANGE_DAYS} days or fewer.`);
  }
  return { from, toExclusive };
}

/**
 * Admin-only aggregates. Real sales are successful LIVE payments
 * (`isSimulated: false`, not refunded) on orders that were not cancelled.
 * DEMO payments are summed separately and never added to live sales.
 */
export async function adminReports(prisma: PrismaClient, query: AdminReportQuery) {
  const { from, toExclusive } = resolveRange(query);
  const dimensions: Prisma.OrderWhereInput = {
    ...(query.canteenId ? { canteenId: query.canteenId } : {}),
    ...(query.servicePeriod ? { servicePeriod: query.servicePeriod } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
  };
  const paymentOnOrder: Prisma.PaymentWhereInput | undefined =
    query.paymentMode === 'DEMO'
      ? { isSimulated: true, ...(query.paymentMethod ? { provider: query.paymentMethod } : {}) }
      : query.paymentMode === 'LIVE'
        ? {
            isSimulated: false,
            status: 'SUCCESS',
            refundedAt: null,
            ...(query.paymentMethod ? { provider: query.paymentMethod } : {}),
          }
        : query.paymentMethod
          ? { provider: query.paymentMethod }
          : undefined;
  const createdWhere: Prisma.OrderWhereInput = {
    ...dimensions,
    createdAt: { gte: from, lt: toExclusive },
    ...(paymentOnOrder ? { payment: paymentOnOrder } : {}),
  };
  const paidOrder: Prisma.OrderWhereInput = {
    ...dimensions,
    paidAt: { gte: from, lt: toExclusive },
    status: { notIn: ['PLACED', 'CANCELLED'] },
  };
  const livePayment: Prisma.PaymentWhereInput | null =
    query.paymentMode === 'DEMO'
      ? null
      : {
          status: 'SUCCESS',
          isSimulated: false,
          refundedAt: null,
          ...(query.paymentMethod ? { provider: query.paymentMethod } : {}),
        };
  const liveWhere: Prisma.OrderWhereInput | null = livePayment
    ? { ...paidOrder, payment: livePayment }
    : null;
  const demoPayment: Prisma.PaymentWhereInput | null =
    query.paymentMode === 'LIVE'
      ? null
      : {
          status: 'SUCCESS',
          isSimulated: true,
          refundedAt: null,
          ...(query.paymentMethod ? { provider: query.paymentMethod } : {}),
          paidAt: { gte: from, lt: toExclusive },
          order: {
            ...dimensions,
            status: { notIn: ['PLACED', 'CANCELLED'] },
          },
        };

  const [
    orderCounts,
    cancelled,
    rejected,
    demo,
    liveOrders,
    liveByProvider,
    liveByCanteen,
    liveByPeriod,
    liveByChannel,
    topItems,
    canteens,
  ] = await Promise.all([
    prisma.order.groupBy({
      by: ['channel'],
      where: createdWhere,
      _count: { _all: true },
    }),
    prisma.order.count({ where: { ...createdWhere, status: 'CANCELLED' } }),
    prisma.payment.count({
      where: {
        status: 'FAILED',
        createdAt: { gte: from, lt: toExclusive },
        ...(query.paymentMode === 'DEMO' ? { isSimulated: true } : {}),
        ...(query.paymentMode === 'LIVE' ? { isSimulated: false } : {}),
        ...(query.paymentMethod ? { provider: query.paymentMethod } : {}),
        order: dimensions,
      },
    }),
    demoPayment
      ? prisma.payment.aggregate({
          where: demoPayment,
          _sum: { amountPaise: true },
        })
      : Promise.resolve({ _sum: { amountPaise: 0 } }),
    liveWhere
      ? prisma.order.findMany({
          where: liveWhere,
          select: { paidAt: true, totalPaise: true, channel: true },
        })
      : Promise.resolve([]),
    livePayment
      ? prisma.payment.groupBy({
          by: ['provider'],
          where: { ...livePayment, order: paidOrder },
          _sum: { amountPaise: true },
        })
      : Promise.resolve([]),
    liveWhere
      ? prisma.order.groupBy({
          by: ['canteenId'],
          where: liveWhere,
          _sum: { totalPaise: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    liveWhere
      ? prisma.order.groupBy({
          by: ['servicePeriod'],
          where: liveWhere,
          _sum: { totalPaise: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    liveWhere
      ? prisma.order.groupBy({
          by: ['channel'],
          where: liveWhere,
          _sum: { totalPaise: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    liveWhere
      ? prisma.orderItem.groupBy({
          by: ['itemName'],
          where: { order: liveWhere },
          _sum: { quantity: true, lineTotalPaise: true },
        })
      : Promise.resolve([]),
    prisma.canteen.findMany({
      where: query.canteenId ? { id: query.canteenId } : {},
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const channelOrders = (channel: 'APP' | 'WALK_IN') =>
    orderCounts.find((row) => row.channel === channel)?._count._all ?? 0;
  const providerPaise = (provider: 'CASH' | 'UPI') =>
    liveByProvider.find((row) => row.provider === provider)?._sum.amountPaise ?? 0;
  const liveSalesPaise = liveByProvider.reduce((sum, row) => sum + (row._sum.amountPaise ?? 0), 0);
  const cashSalesPaise = providerPaise('CASH');
  const upiSalesPaise = providerPaise('UPI');
  const otherLiveSalesPaise = Math.max(0, liveSalesPaise - cashSalesPaise - upiSalesPaise);

  const byDate = new Map<string, { liveSalesPaise: number; orderCount: number }>();
  for (let cursor = from.getTime(); cursor < toExclusive.getTime(); cursor += DAY_MS) {
    byDate.set(formatIstDate(new Date(cursor)), { liveSalesPaise: 0, orderCount: 0 });
  }
  for (const order of liveOrders) {
    if (!order.paidAt) continue;
    const bucket = byDate.get(formatIstDate(order.paidAt));
    if (!bucket) continue;
    bucket.liveSalesPaise += order.totalPaise;
    bucket.orderCount += 1;
  }

  const periodRow = (period: 'DAY' | 'NIGHT' | null) =>
    liveByPeriod.find((row) => row.servicePeriod === period);
  const channelSale = (channel: 'APP' | 'WALK_IN') =>
    liveByChannel.find((row) => row.channel === channel);

  return {
    range: {
      from: formatIstDate(from),
      to: formatIstDate(new Date(toExclusive.getTime() - 1)),
    },
    filters: {
      canteenId: query.canteenId ?? null,
      servicePeriod: query.servicePeriod ?? null,
      channel: query.channel ?? null,
      paymentMethod: query.paymentMethod ?? null,
      paymentMode: query.paymentMode ?? null,
    },
    orders: {
      total: orderCounts.reduce((sum, row) => sum + row._count._all, 0),
      app: channelOrders('APP'),
      walkIn: channelOrders('WALK_IN'),
      cancelled,
    },
    payments: {
      liveSalesPaise,
      cashSalesPaise,
      upiSalesPaise,
      otherLiveSalesPaise,
      demoSalesPaise: demo._sum.amountPaise ?? 0,
      rejected,
    },
    series: [...byDate.entries()].map(([date, row]) => ({ date, ...row })),
    byCanteen: canteens.map((canteen) => {
      const row = liveByCanteen.find((entry) => entry.canteenId === canteen.id);
      return {
        id: canteen.id,
        name: canteen.name,
        liveSalesPaise: row?._sum.totalPaise ?? 0,
        orderCount: row?._count._all ?? 0,
      };
    }),
    byPeriod: (['DAY', 'NIGHT', null] as const).map((period) => ({
      period: period ?? 'UNSET',
      liveSalesPaise: periodRow(period)?._sum.totalPaise ?? 0,
      orderCount: periodRow(period)?._count._all ?? 0,
    })),
    byChannel: (['APP', 'WALK_IN'] as const).map((channel) => ({
      channel,
      orderCount: channelOrders(channel),
      liveSalesPaise: channelSale(channel)?._sum.totalPaise ?? 0,
    })),
    byMethod: [
      { method: 'CASH' as const, liveSalesPaise: cashSalesPaise },
      { method: 'UPI' as const, liveSalesPaise: upiSalesPaise },
      { method: 'OTHER' as const, liveSalesPaise: otherLiveSalesPaise },
    ],
    topItems: topItems
      .map((row) => ({
        name: row.itemName,
        quantity: row._sum.quantity ?? 0,
        liveSalesPaise: row._sum.lineTotalPaise ?? 0,
      }))
      .sort((a, b) => b.liveSalesPaise - a.liveSalesPaise || b.quantity - a.quantity)
      .slice(0, 8),
  };
}

/** Per-canteen payment configuration status. Official UPI values stay on the detail endpoint. */
export async function adminPaymentOverview(prisma: PrismaClient) {
  const rows = await prisma.canteen.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      paymentConfig: {
        select: {
          mode: true,
          upiVpa: true,
          merchantName: true,
          qrImageUrl: true,
          qrStorageKey: true,
          updatedAt: true,
        },
      },
    },
  });
  const canteens = rows.map((row) => {
    const config = row.paymentConfig;
    const ready = config ? officialDetailsReady(config) : false;
    const incomplete = !config || (config.mode === 'LIVE' && !ready);
    return {
      id: row.id,
      name: row.name,
      mode: config?.mode ?? null,
      merchantName: config?.merchantName ?? null,
      upiConfigured: Boolean(config?.upiVpa),
      qrConfigured: Boolean(config?.qrImageUrl || config?.qrStorageKey),
      incomplete,
      updatedAt: config?.updatedAt ?? null,
    };
  });
  return {
    totals: {
      canteens: canteens.length,
      demo: canteens.filter((row) => row.mode === 'DEMO').length,
      live: canteens.filter((row) => row.mode === 'LIVE').length,
      incompleteLive: canteens.filter((row) => row.mode === 'LIVE' && row.incomplete).length,
    },
    canteens,
  };
}
