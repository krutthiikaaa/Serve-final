/**
 * Payment provider abstraction. The backend owns the amount: providers are
 * only ever asked to collect the server-calculated order total.
 *
 * Implementations:
 *  - MockPaymentProvider      development/test, and production only with
 *                             DEMO_MODE=true (no real money moves)
 *  - RazorpayPaymentProvider  signature verification implemented; API calls
 *                             pending (they fail with 503, never fake success)
 */
export type ProviderName = 'MOCK' | 'RAZORPAY';

export interface CreateProviderOrderInput {
  amountPaise: number;
  currency: 'INR';
  /** Our public order number, for reconciliation. */
  receipt: string;
}

export interface ProviderOrder {
  providerOrderId: string;
  amountPaise: number;
  currency: string;
}

export interface PaymentConfirmation {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface ProviderPayment {
  providerPaymentId: string;
  providerOrderId: string;
  amountPaise: number;
  status: 'captured' | 'failed';
}

export interface PaymentProvider {
  readonly name: ProviderName;
  /** Create a provider-side order for the given server-calculated amount. */
  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder>;
  /** Verify the signature returned to the client after checkout. */
  verifyPaymentSignature(confirmation: PaymentConfirmation): boolean;
  /**
   * Server-to-server lookup of what was actually captured. `providerOrderId`
   * is the order the (already signature-verified) payment claims to belong to.
   */
  fetchPayment(providerPaymentId: string, providerOrderId: string): Promise<ProviderPayment>;
  refund(providerPaymentId: string, amountPaise: number): Promise<{ refundId: string }>;
  /** Verify a webhook body signature (raw bytes, as received). */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}
