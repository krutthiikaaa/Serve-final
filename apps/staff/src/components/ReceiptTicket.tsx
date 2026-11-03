import type { Receipt } from '@serve/contracts';
import { Button, Logo, formatRupees, formatDateTime } from '@serve/web-shared';

export function ReceiptTicket({ receipt }: { receipt: Receipt }) {
  return (
    <article className="receipt-ticket" aria-label={`Receipt ${receipt.receiptNumber}`}>
      <div className="receipt-brand">
        <Logo size={48} />
        <strong>SERVE</strong>
      </div>
      <p className="receipt-university">{receipt.universityName}</p>
      <p className="receipt-canteen">{receipt.canteen.name}</p>
      {receipt.simulated ? (
        <p className="receipt-demo">{receipt.notice ?? 'DEMO TRANSACTION — NO REAL PAYMENT'}</p>
      ) : null}
      <dl className="receipt-meta">
        <div>
          <dt>Receipt</dt>
          <dd>{receipt.receiptNumber}</dd>
        </div>
        <div>
          <dt>Order</dt>
          <dd>{receipt.orderNumber}</dd>
        </div>
        {receipt.pickupToken ? (
          <div>
            <dt>Pickup token</dt>
            <dd>{receipt.pickupToken}</dd>
          </div>
        ) : null}
        <div>
          <dt>When</dt>
          <dd>{formatDateTime(receipt.paidAt)}</dd>
        </div>
        <div>
          <dt>Service</dt>
          <dd>{receipt.servicePeriod === 'DAY' ? 'Day' : receipt.servicePeriod === 'NIGHT' ? 'Night' : '—'}</dd>
        </div>
      </dl>
      <table className="receipt-lines">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Each</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((item) => (
            <tr key={`${item.itemName}-${item.quantity}-${item.unitPricePaise}`}>
              <td>{item.itemName}</td>
              <td>{item.quantity}</td>
              <td>{formatRupees(item.unitPricePaise)}</td>
              <td>{formatRupees(item.lineTotalPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="receipt-total">
        <span>Grand total</span>
        <strong>{formatRupees(receipt.totalPaise)}</strong>
      </p>
      <p className="receipt-pay">
        {receipt.simulated
          ? 'DEMO · Simulated — no real payment'
          : `${receipt.paymentMethod} · Paid`}
        {receipt.utr ? ` · Ref ${receipt.utr}` : ''}
      </p>
      <p className="receipt-customer">
        {receipt.studentName ?? receipt.guestName ?? 'Walk-in customer'}
      </p>
      {receipt.verifiedByName ? (
        <p className="muted small">Verified by {receipt.verifiedByName}</p>
      ) : null}
      <div className="no-print receipt-actions">
        <Button variant="secondary" onClick={() => window.print()}>
          Print receipt
        </Button>
      </div>
    </article>
  );
}
