import { randomUUID } from 'node:crypto';
import type {
  CreateProviderOrderInput,
  PaymentConfirmation,
  PaymentProvider,
  ProviderOrder,
  ProviderPayment,
} from './provider.js';
import { hmacSha256Hex, signaturesMatch } from './signature.js';
import { NotFoundError } from '../../lib/errors.js';

/**
 * Development/test payment provider that simulates a gateway.
 *
 * It behaves like Razorpay's checkout contract: an order is created for the
 * server amount, the "gateway" captures a payment and returns
 * (orderId, paymentId, HMAC signature), and the backend verifies the signature
 * AND the captured amount before confirming. Gateway state is in-memory; this
 * provider is rejected by configuration in production.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'MOCK' as const;
  private readonly orders = new Map<string, ProviderOrder>();
  private readonly payments = new Map<string, ProviderPayment>();

  constructor(private readonly secret: string) {}

  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    const order: ProviderOrder = {
      providerOrderId: `mock_order_${randomUUID().replaceAll('-', '')}`,
      amountPaise: input.amountPaise,
      currency: input.currency,
    };
    this.orders.set(order.providerOrderId, order);
    return Promise.resolve(order);
  }

  /**
   * Simulates the customer completing checkout on the gateway.
   * `capturedAmountPaise` lets tests simulate a gateway reporting a different
   * captured amount (which the backend must reject).
   */
  simulateCheckout(
    providerOrderId: string,
    options: { outcome: 'success' | 'failure'; capturedAmountPaise?: number },
  ): PaymentConfirmation & { status: 'captured' | 'failed' } {
    const order = this.orders.get(providerOrderId);
    if (!order) throw new NotFoundError('Payment session not found.', 'PAYMENT_SESSION_NOT_FOUND');
    const providerPaymentId = `mock_pay_${randomUUID().replaceAll('-', '')}`;
    const status = options.outcome === 'success' ? 'captured' : 'failed';
    this.payments.set(providerPaymentId, {
      providerPaymentId,
      providerOrderId,
      amountPaise: options.capturedAmountPaise ?? order.amountPaise,
      status,
    });
    return {
      providerOrderId,
      providerPaymentId,
      signature: hmacSha256Hex(this.secret, `${providerOrderId}|${providerPaymentId}`),
      status,
    };
  }

  verifyPaymentSignature({
    providerOrderId,
    providerPaymentId,
    signature,
  }: PaymentConfirmation): boolean {
    return signaturesMatch(
      hmacSha256Hex(this.secret, `${providerOrderId}|${providerPaymentId}`),
      signature,
    );
  }

  fetchPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const payment = this.payments.get(providerPaymentId);
    if (!payment)
      return Promise.reject(new NotFoundError('Payment not found.', 'PAYMENT_NOT_FOUND'));
    return Promise.resolve(payment);
  }

  refund(): Promise<{ refundId: string }> {
    return Promise.resolve({ refundId: `mock_refund_${randomUUID().replaceAll('-', '')}` });
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return signaturesMatch(hmacSha256Hex(this.secret, rawBody), signature);
  }
}
