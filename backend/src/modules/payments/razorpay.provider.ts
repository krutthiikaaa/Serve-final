import type {
  PaymentConfirmation,
  PaymentProvider,
  ProviderOrder,
  ProviderPayment,
} from './provider.js';
import { hmacSha256Hex, signaturesMatch } from './signature.js';
import { ServiceUnavailableError } from '../../lib/errors.js';

const notImplemented = () =>
  Promise.reject(
    new ServiceUnavailableError(
      'Online payments are not available yet. Razorpay integration is pending.',
      'PAYMENT_PROVIDER_NOT_IMPLEMENTED',
    ),
  );

/**
 * Razorpay adapter — NOT ACTIVE YET.
 *
 * Implemented: signature verification exactly as documented by Razorpay
 * (HMAC-SHA256 of "order_id|payment_id" with the key secret; webhooks signed
 * over the raw body with the webhook secret).
 * Pending: Orders/Payments/Refunds API calls. Until they are implemented these
 * methods fail with 503 — they never pretend a payment succeeded.
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = 'RAZORPAY' as const;

  constructor(
    private readonly config: { keyId: string; keySecret: string; webhookSecret: string },
  ) {}

  createOrder(): Promise<ProviderOrder> {
    return notImplemented();
  }

  verifyPaymentSignature({
    providerOrderId,
    providerPaymentId,
    signature,
  }: PaymentConfirmation): boolean {
    return signaturesMatch(
      hmacSha256Hex(this.config.keySecret, `${providerOrderId}|${providerPaymentId}`),
      signature,
    );
  }

  fetchPayment(): Promise<ProviderPayment> {
    return notImplemented();
  }

  refund(): Promise<{ refundId: string }> {
    return notImplemented();
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return signaturesMatch(hmacSha256Hex(this.config.webhookSecret, rawBody), signature);
  }
}
