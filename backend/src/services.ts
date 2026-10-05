import type { AppContext } from './context.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createCanteensService } from './modules/canteens/canteens.service.js';
import { createMenuService } from './modules/menu/menu.service.js';
import { createOrdersService } from './modules/orders/orders.service.js';
import { createPaymentsService } from './modules/payments/payments.service.js';
import { createChangeRequestsService } from './modules/change-requests/change-requests.service.js';
import { createNotificationsService } from './modules/notifications/notifications.service.js';
import { createStaffService } from './modules/staff/staff.service.js';
import { createAdminService } from './modules/admin/admin.service.js';
import { createRecommendationsService } from './modules/students/recommendations.service.js';

export function createServices(ctx: AppContext) {
  const canteens = createCanteensService(ctx.prisma);
  return {
    auth: createAuthService(ctx),
    canteens,
    menu: createMenuService(ctx.prisma, ctx.events),
    orders: createOrdersService(ctx),
    payments: createPaymentsService(ctx),
    changeRequests: createChangeRequestsService(ctx.prisma, ctx.events),
    notifications: createNotificationsService(ctx.prisma),
    staff: createStaffService(ctx.prisma, ctx.events),
    admin: createAdminService(ctx.prisma, ctx.events),
    recommendations: createRecommendationsService(ctx.prisma, canteens),
  };
}

export type Services = ReturnType<typeof createServices>;
