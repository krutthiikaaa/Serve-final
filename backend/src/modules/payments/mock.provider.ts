import { randomBytes, randomUUID } from 'node:crypto';
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
 * It follows Razorpay's checkout contract: an order is created for the server
 * amount, the "gateway" captures a payment and returns
 * (orderId, paymentId, HMAC signature), and the backend verifies the signature
 * AND the captured amount before confirming.
 *
 * Stateless: the captured amount and outcome are encoded in the mock payment
 * id, which is covered by the HMAC signature, so a server restart between
 * initiation and completion does not strand a payment. Rejected by
 * configuration in production unless DEMO_MODE=true declares a demo.
 */
const MOCK_PAYMENT_ID = /^mock_pay_(\d+)_(captured|failed)_[0-9a-f]{16}$/;

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'MOCK' as const;

  constructor(private readonly secret: string) {}

  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    return Promise.resolve({
      providerOrderId: `mock_order_${randomUUID().replaceAll('-', '')}`,
      amountPaise: input.amountPaise,
      currency: input.currency,
    });
  }

  /**
   * Simulates the customer completing checkout on the gateway for
   * `amountPaise` (the provider order amount). `capturedAmountPaise` lets tests
   * simulate a gateway reporting a different captured amount, which the
   * backend must reject.
   */
  simulateCheckout(
    providerOrderId: string,
    options: { outcome: 'success' | 'failure'; amountPaise: number; capturedAmountPaise?: number },
  ): PaymentConfirmation & { status: 'captured' | 'failed' } {
    const status = options.outcome === 'success' ? 'captured' : 'failed';
    const captured = options.capturedAmountPaise ?? options.amountPaise;
    const providerPaymentId = `mock_pay_${captured}_${status}_${randomBytes(8).toString('hex')}`;
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

  /** Callers verify the signature (which binds paymentId to orderId) first. */
  fetchPayment(providerPaymentId: string, providerOrderId: string): Promise<ProviderPayment> {
    const match = MOCK_PAYMENT_ID.exec(providerPaymentId);
    if (!match) return Promise.reject(new NotFoundError('Payment not found.', 'PAYMENT_NOT_FOUND'));
    return Promise.resolve({
      providerPaymentId,
      providerOrderId,
      amountPaise: Number(match[1]),
      status: match[2] as 'captured' | 'failed',
    });
  }

  refund(): Promise<{ refundId: string }> {
    return Promise.resolve({ refundId: `mock_refund_${randomUUID().replaceAll('-', '')}` });
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return signaturesMatch(hmacSha256Hex(this.secret, rawBody), signature);
  }
}
