import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import type { IdentityVerifier } from './lib/firebase.js';
import type { PrismaClient } from './lib/prisma.js';
import type { EventPublisher } from './realtime/events.js';
import type { PaymentProvider } from './modules/payments/provider.js';

/** Dependencies shared by every module; injected so tests run the real stack. */
export interface AppContext {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  verifier: IdentityVerifier;
  events: EventPublisher;
  payments: PaymentProvider;
}
