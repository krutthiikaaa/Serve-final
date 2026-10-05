import type { Env } from '../../config/env.js';
import { MockPaymentProvider } from './mock.provider.js';
import type { PaymentProvider } from './provider.js';
import { RazorpayPaymentProvider } from './razorpay.provider.js';

/** Build the configured provider. Env validation guarantees required secrets exist. */
export function createPaymentProvider(env: Env): PaymentProvider {
  if (env.PAYMENT_MODE === 'mock') {
    if (!env.PAYMENT_SECRET) throw new Error('PAYMENT_SECRET is required for the mock provider');
    return new MockPaymentProvider(env.PAYMENT_SECRET);
  }
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET) {
    throw new Error('Razorpay credentials are not configured');
  }
  return new RazorpayPaymentProvider({
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  });
}
