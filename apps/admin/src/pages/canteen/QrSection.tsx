import { useRef, useState, type ChangeEvent } from 'react';
import type { CanteenPaymentConfig, QrOverview } from '@serve/contracts';
import {
  Button,
  CanteenTypeBadge,
  ErrorState,
  IconUpload,
  Modal,
  SkeletonRows,
  Tag,
  errorMessage,
  formatDateTime,
  useRealtime,
  useResource,
  useServerEvent,
  useToast,
} from '@serve/web-shared';
import { useAdminApi } from '../../useAdminApi';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 1024 * 1024;

/** Validate before uploading; the server repeats every check (magic bytes, size). */
export function qrFileProblem(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return 'Choose a PNG, JPEG or WEBP image.';
  if (file.size > MAX_BYTES) return 'The QR image must be 1 MB or smaller.';
  if (file.size === 0) return 'This file is empty.';
  return null;
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * The canteen's payment QR. Every canteen (Day or Night) has its own. Until an
 * official QR is uploaded and the canteen takes live payments, students see
 * a generated placeholder clearly marked DEMO.
 */
export function QrSection({ canteenId, canteenName }: { canteenId: string; canteenName: string }) {
  const api = useAdminApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const qr = useResource(() => api.qr(canteenId), [api, canteenId, connectionEpoch]);
  const config = useResource(() => api.paymentConfig(canteenId), [api, canteenId, connectionEpoch]);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useServerEvent('canteen.payment_qr_updated', (data) => {
    if (data.canteenId === canteenId) {
      void qr.reload();
      void config.reload();
    }
  });

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const issue = qrFileProblem(file);
    setProblem(issue);
    if (issue) return;
    setBusy(true);
    try {
      const replacing = Boolean(qr.data?.active);
      await api.uploadQr(canteenId, file);
      await Promise.all([qr.reload(), config.reload()]);
      toast(replacing ? `QR replaced for ${canteenName}` : `QR uploaded for ${canteenName}`);
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.removeQr(canteenId);
      await Promise.all([qr.reload(), config.reload()]);
      setConfirmRemove(false);
      toast(`QR removed for ${canteenName}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section" aria-labelledby="qr-heading">
      <div className="section-header">
        <div>
          <h2 id="qr-heading">Payment QR</h2>
          <p className="muted small">Students paying for this canteen’s orders see this QR.</p>
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED.join(',')}
          className="sr-only"
          aria-label="QR image file"
          onChange={(e) => void onFile(e)}
        />
        <div className="header-actions">
          {qr.data?.active ? (
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </Button>
          ) : null}
          <Button
            size="sm"
            icon={<IconUpload width={14} height={14} />}
            loading={busy}
            onClick={() => input.current?.click()}
          >
            {qr.data?.active ? 'Replace QR' : 'Upload QR'}
          </Button>
        </div>
      </div>

      {qr.loading && !qr.data ? (
        <SkeletonRows rows={3} />
      ) : qr.error && !qr.data ? (
        <ErrorState error={qr.error} onRetry={() => void qr.reload()} />
      ) : qr.data ? (
        <QrBody
          data={qr.data}
          config={config.data ?? null}
          problem={problem}
          imageUrl={qr.data.active ? api.assetUrl(qr.data.active.url) : null}
        />
      ) : null}

      {confirmRemove ? (
        <Modal
          title="Remove this QR?"
          onClose={() => setConfirmRemove(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                Keep QR
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void remove()}>
                Remove QR
              </Button>
            </>
          }
        >
          <p>
            Students will see the placeholder QR again. The image stays in this canteen’s history.
          </p>
        </Modal>
      ) : null}
    </section>
  );
}

function QrBody({
  data,
  config,
  problem,
  imageUrl,
}: {
  data: QrOverview;
  config: CanteenPaymentConfig | null;
  problem: string | null;
  imageUrl: string | null;
}) {
  const placeholder = config?.demoQr ?? null;
  return (
    <div className="qr-layout">
      <figure className="qr-preview">
        {imageUrl ? (
          <img src={imageUrl} alt={`Payment QR for ${data.canteen.name}`} />
        ) : placeholder ? (
          <img
            alt={placeholder.warning}
            src={`data:image/svg+xml;utf8,${encodeURIComponent(placeholder.svg)}`}
          />
        ) : (
          <div className="qr-empty">No QR</div>
        )}
        <figcaption className="muted small">
          {imageUrl ? 'Uploaded QR' : 'Placeholder · DEMO, not payable'}
        </figcaption>
      </figure>
      <div className="qr-meta">
        {problem ? (
          <p className="notice" role="alert">
            {problem}
          </p>
        ) : null}
        <dl className="detail-grid">
          <dt>Canteen</dt>
          <dd>
            {data.canteen.name} <CanteenTypeBadge type={data.canteen.type} />
          </dd>
          <dt>QR status</dt>
          <dd>{data.active ? <Tag tone="success">Active</Tag> : <Tag>Placeholder only</Tag>}</dd>
          <dt>Students see</dt>
          <dd>
            {data.studentSees === 'UPLOADED_QR' ? (
              <Tag tone="success">Uploaded QR</Tag>
            ) : (
              <Tag tone="warning">Placeholder (DEMO)</Tag>
            )}
          </dd>
          <dt>Last updated</dt>
          <dd>
            {data.active ? (
              formatDateTime(data.active.uploadedAt)
            ) : (
              <span className="muted">—</span>
            )}
            {data.active?.uploadedBy ? (
              <span className="muted small"> · {data.active.uploadedBy.name}</span>
            ) : null}
          </dd>
          {data.active ? (
            <>
              <dt>File</dt>
              <dd className="muted">
                {data.active.contentType.replace('image/', '').toUpperCase()} ·{' '}
                {kb(data.active.sizeBytes)}
              </dd>
            </>
          ) : null}
        </dl>
        {data.active && data.mode !== 'LIVE' ? (
          <p className="muted small">
            This canteen is in test mode, so students still see the placeholder. Switch it to live
            payments under UPI payments once the UPI ID and merchant name are set.
          </p>
        ) : null}
        {data.history.length > (data.active ? 1 : 0) ? (
          <details className="qr-history">
            <summary>
              Previous QR codes ({data.history.filter((row) => !row.isActive).length})
            </summary>
            <ul className="plain-list">
              {data.history
                .filter((row) => !row.isActive)
                .map((row) => (
                  <li key={row.id}>
                    <span>
                      Uploaded {formatDateTime(row.uploadedAt)}
                      {row.uploadedBy ? ` by ${row.uploadedBy.name}` : ''}
                    </span>
                    <span className="muted small">
                      Replaced {row.deactivatedAt ? formatDateTime(row.deactivatedAt) : '—'}
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
