import { useEffect, useState, type FormEvent } from 'react';
import type { CanteenPaymentConfig } from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  Select,
  SkeletonRows,
  Tag,
  TextArea,
  errorMessage,
  fieldErrors,
  useRealtime,
  useResource,
  useToast,
} from '@serve/web-shared';
import { useAdminApi } from '../../useAdminApi';

export function PaymentSection({ canteenId }: { canteenId: string }) {
  const api = useAdminApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const config = useResource(() => api.paymentConfig(canteenId), [api, canteenId, connectionEpoch]);
  const [editing, setEditing] = useState(false);

  if (config.loading && config.data === undefined)
    return (
      <section className="section">
        <div className="section-header">
          <h2>UPI payments</h2>
        </div>
        <SkeletonRows rows={3} />
      </section>
    );
  if (config.error && config.data === undefined)
    return (
      <section className="section">
        <div className="section-header">
          <h2>UPI payments</h2>
        </div>
        <ErrorState error={config.error} onRetry={() => void config.reload()} />
      </section>
    );

  const row = config.data;

  return (
    <section className="section">
      <div className="section-header">
        <h2>UPI payments</h2>
        {row && !editing ? (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>
      {editing ? (
        <PaymentForm
          canteenId={canteenId}
          initial={row ?? null}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await config.reload();
            toast('Payment configuration saved');
          }}
        />
      ) : !row ? (
        <EmptyState
          title="Payment has not been configured"
          body="Add a UPI ID and QR image URL when you are ready. Nothing is invented until you save."
          action={<Button onClick={() => setEditing(true)}>Configure UPI</Button>}
        />
      ) : (
        <div className="section-body">
          {row.mode === 'DEMO' ? (
            <div className="notice" role="status">
              DEMO mode is active. This canteen’s QR is a placeholder and is not payable.
            </div>
          ) : null}
          {row.warnings.includes('LIVE_CONFIG_INCOMPLETE') ? (
            <div className="notice" role="status">
              LIVE mode needs a valid UPI ID, merchant name, and official QR before it can be used.
            </div>
          ) : null}
          <dl className="detail-grid">
            <dt>Mode</dt>
            <dd>
              {row.mode === 'LIVE' ? <Tag tone="success">LIVE</Tag> : <Tag tone="warning">DEMO</Tag>}
            </dd>
            <dt>Status</dt>
            <dd>
              {row.isActive ? (
                <Tag tone="success">Active</Tag>
              ) : (
                <Tag tone="neutral">Inactive</Tag>
              )}
            </dd>
            <dt>UPI ID</dt>
            <dd>{row.upiVpa ?? <span className="muted">Not set</span>}</dd>
            <dt>Merchant name</dt>
            <dd>{row.merchantName ?? <span className="muted">Not set</span>}</dd>
            <dt>QR image URL</dt>
            <dd className="break-url">
              {row.qrImageUrl ?? <span className="muted">Not set</span>}
            </dd>
            <dt>Storage key</dt>
            <dd>{row.qrStorageKey ?? <span className="muted">Not set</span>}</dd>
            <dt>Instructions</dt>
            <dd>{row.instructions ?? <span className="muted">Not set</span>}</dd>
          </dl>
          {row.demoQr ? (
            <div className="demo-qr-block">
              <img
                alt={row.demoQr.warning}
                src={`data:image/svg+xml;utf8,${encodeURIComponent(row.demoQr.svg)}`}
              />
              <p className="muted small">{row.demoQr.warning}. This is not an official university QR code.</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PaymentForm({
  canteenId,
  initial,
  onClose,
  onSaved,
}: {
  canteenId: string;
  initial: CanteenPaymentConfig | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const api = useAdminApi();
  const [mode, setMode] = useState<'DEMO' | 'LIVE'>(initial?.mode ?? 'DEMO');
  const [upiVpa, setUpiVpa] = useState(initial?.upiVpa ?? '');
  const [merchantName, setMerchantName] = useState(initial?.merchantName ?? '');
  const [qrImageUrl, setQrImageUrl] = useState(initial?.qrImageUrl ?? '');
  const [qrStorageKey, setQrStorageKey] = useState(initial?.qrStorageKey ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(initial?.mode ?? 'DEMO');
    setUpiVpa(initial?.upiVpa ?? '');
    setMerchantName(initial?.merchantName ?? '');
    setQrImageUrl(initial?.qrImageUrl ?? '');
    setQrStorageKey(initial?.qrStorageKey ?? '');
    setInstructions(initial?.instructions ?? '');
    setIsActive(initial?.isActive ?? false);
  }, [initial]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updatePaymentConfig(canteenId, {
        mode,
        upiVpa: upiVpa.trim() || null,
        merchantName: merchantName.trim() || null,
        qrImageUrl: qrImageUrl.trim() || null,
        qrStorageKey: qrStorageKey.trim() || null,
        instructions: instructions.trim() || null,
        isActive,
      });
      await onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="section-body">
      <form className="form" onSubmit={(e) => void submit(e)} noValidate>
        <FormError error={error} />
        {mode === 'DEMO' ? (
          <div className="notice" role="status">
            DEMO mode uses a non-payable placeholder QR. LIVE requires official UPI, merchant and QR details.
          </div>
        ) : null}
        <Field label="Payment mode" hint="LIVE is per canteen and never copies another canteen’s details.">
          {(p) => (
            <Select
              {...p}
              value={mode}
              onChange={(e) => setMode(e.target.value as 'DEMO' | 'LIVE')}
            >
              <option value="DEMO">DEMO</option>
              <option value="LIVE">LIVE</option>
            </Select>
          )}
        </Field>
        <Field label="UPI ID / VPA" error={errors.upiVpa} hint="For example name@okicici">
          {(p) => (
            <Input
              {...p}
              value={upiVpa}
              onChange={(e) => setUpiVpa(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label="Merchant display name" error={errors.merchantName}>
          {(p) => (
            <Input {...p} value={merchantName} onChange={(e) => setMerchantName(e.target.value)} />
          )}
        </Field>
        <Field
          label="QR image URL"
          error={errors.qrImageUrl}
          hint="Official https URL only. Demo placeholders are generated separately and are not stored here."
        >
          {(p) => (
            <Input
              {...p}
              value={qrImageUrl}
              onChange={(e) => setQrImageUrl(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field
          label="Managed storage key"
          error={errors.qrStorageKey}
          hint="Optional object key if the QR is stored by SERVE later. No file upload in this screen."
        >
          {(p) => (
            <Input
              {...p}
              value={qrStorageKey}
              onChange={(e) => setQrStorageKey(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label="Payment instructions" error={errors.instructions}>
          {(p) => (
            <TextArea
              {...p}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={500}
            />
          )}
        </Field>
        <label className="switch">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="switch-track" />
          Configuration is active
        </label>
        <div className="row-actions start">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save payment configuration
          </Button>
        </div>
      </form>
    </div>
  );
}
