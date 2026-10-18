import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import type { OrderStatus } from '@serve/contracts';
import { errorMessage } from '../api';
import { ORDER_STATUS_LABEL } from '../format';
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconFlame,
  IconBag,
  IconRefresh,
  IconX,
  IconWifiOff,
} from './icons';

/* ------------------------------------------------------------------ brand */

/** The official SERVE tagline: brand moments only (sign-in screens). */
export const SERVE_TAGLINE = 'Order. Track. Collect.';

/**
 * The official SERVE logo (`public/brand/serve-logo.png`, transparent; see
 * brand/README.md) with the SERVE name. Shown at its own proportions on light
 * surfaces only, never boxed or redrawn. The path follows the app's base URL
 * (`/staff/`, `/admin/` in builds).
 */
export function Logo({
  size = 32,
  showWordmark = true,
  stacked = false,
}: {
  size?: number;
  showWordmark?: boolean;
  stacked?: boolean;
}) {
  return (
    <span className={`logo${stacked ? ' logo-stacked' : ''}`} role="img" aria-label="SERVE">
      <img
        src={`${import.meta.env.BASE_URL}brand/serve-logo.png`}
        alt=""
        height={size}
        style={{ height: size, width: 'auto' }}
      />
      {showWordmark ? (
        <span className="logo-wordmark" aria-hidden>
          SERVE
        </span>
      ) : null}
    </span>
  );
}

/* ---------------------------------------------------------------- buttons */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner spinner-sm" aria-hidden /> : icon}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

/* ----------------------------------------------------------------- status */

const STATUS_ICON: Record<OrderStatus, ReactNode> = {
  PLACED: <IconClock width={14} height={14} />,
  PAYMENT_CONFIRMED: <IconBag width={14} height={14} />,
  PREPARING: <IconFlame width={14} height={14} />,
  READY: <IconCheck width={14} height={14} />,
  COLLECTED: <IconCheck width={14} height={14} />,
  CANCELLED: <IconX width={14} height={14} />,
};

/** Status is always conveyed by icon + text, not colour alone. */
export function StatusPill({ status, label }: { status: OrderStatus; label?: string }) {
  return (
    <span className={`pill pill-${status.toLowerCase()}`}>
      {STATUS_ICON[status]}
      {label ?? ORDER_STATUS_LABEL[status]}
    </span>
  );
}

export function Tag({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

/* ------------------------------------------------------------ key figures */

export interface Kpi {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Draws the eye (e.g. orders waiting, requests to review). */
  attention?: boolean;
  /** Optional link to the page behind the number. */
  to?: string;
}

/** One card split into columns: a page's key figures at a glance. */
export function KpiStrip({ items, label }: { items: Kpi[]; label: string }) {
  return (
    <div className="kpis" role="group" aria-label={label} aria-live="polite">
      {items.map((item) => {
        const body = (
          <>
            <span className="kpi-label">
              {item.icon}
              {item.label}
            </span>
            <span className="kpi-value">{item.value}</span>
          </>
        );
        const className = `kpi${item.attention ? ' kpi-attention' : ''}`;
        return item.to ? (
          <Link key={item.label} to={item.to} className={className}>
            {body}
          </Link>
        ) : (
          <div key={item.label} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------- page states */

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="center-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="empty-state error-state" role="alert">
      <div className="empty-icon">
        <IconAlert />
      </div>
      <h3>{errorMessage(error)}</h3>
      {onRetry ? (
        <Button variant="secondary" icon={<IconRefresh width={16} height={16} />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function ConnectionBanner({
  state,
}: {
  state: 'connecting' | 'connected' | 'disconnected';
}) {
  if (state === 'connected') return null;
  return (
    <div className="connection-banner" role="status">
      <IconWifiOff width={16} height={16} />
      {state === 'connecting'
        ? 'Connecting to live updates…'
        : 'Live updates paused — reconnecting…'}
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`field${error ? ' field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input className="input" {...props} />
);
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className="input" {...props} />
);
export const TextArea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className="input" rows={3} {...props} />
);

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="form-error" role="alert">
      <IconAlert width={16} height={16} />
      {typeof error === 'string' ? error : errorMessage(error)}
    </div>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <IconX />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- toasts */

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(
  () => undefined,
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
