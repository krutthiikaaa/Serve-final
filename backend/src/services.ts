import type { AppContext } from './context.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createSsoService } from './modules/auth/sso.service.js';
import { createCanteensService } from './modules/canteens/canteens.service.js';
import { createMenuService } from './modules/menu/menu.service.js';
import { createOrdersService } from './modules/orders/orders.service.js';
import { createPaymentsService } from './modules/payments/payments.service.js';
import { createChangeRequestsService } from './modules/change-requests/change-requests.service.js';
import { createNotificationsService } from './modules/notifications/notifications.service.js';
import { createStaffService } from './modules/staff/staff.service.js';
import { createCashierService } from './modules/staff/cashier.service.js';
import { createAdminService } from './modules/admin/admin.service.js';
import { createRecommendationsService } from './modules/students/recommendations.service.js';

export function createServices(ctx: AppContext) {
  const canteens = createCanteensService(ctx.prisma, { clock: ctx.clock, logger: ctx.logger });
  return {
    auth: createAuthService(ctx),
    sso: createSsoService(ctx),
    canteens,
    menu: createMenuService(ctx.prisma, ctx.events),
    orders: createOrdersService(ctx),
    payments: createPaymentsService(ctx),
    changeRequests: createChangeRequestsService(ctx.prisma, ctx.events, ctx.logger),
    notifications: createNotificationsService(ctx.prisma),
    staff: createStaffService(ctx.prisma, ctx.events),
    cashier: createCashierService(ctx.prisma, ctx.events, canteens),
    admin: createAdminService(ctx.prisma, ctx.events, ctx.logger),
    recommendations: createRecommendationsService(ctx.prisma, canteens, ctx.clock),
  };
}

export type Services = ReturnType<typeof createServices>;
