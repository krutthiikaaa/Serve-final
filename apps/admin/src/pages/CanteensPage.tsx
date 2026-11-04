import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AdminCanteen, Canteen, PublicCanteen, ServicePeriod } from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  IconPause,
  IconPlay,
  IconPlus,
  IconStore,
  Input,
  Modal,
  Select,
  SkeletonRows,
  Tag,
  errorMessage,
  fieldErrors,
  useRealtime,
  useResource,
  useServerEvent,
  useToast,
} from '@serve/web-shared';
import type { CanteenInput } from '../api/admin';
import { useAdminApi } from '../useAdminApi';

export function CanteenStatus({ canteen }: { canteen: Pick<Canteen, 'status'> }) {
  if (canteen.status === 'INACTIVE') return <Tag tone="danger">Inactive</Tag>;
  if (canteen.status === 'PAUSED') return <Tag tone="warning">Paused</Tag>;
  return <Tag tone="success">Accepting orders</Tag>;
}

const PERIOD_SHORT: Record<ServicePeriod, string> = { DAY: 'Day', NIGHT: 'Night' };

function ServicePeriodTags({ live }: { live: PublicCanteen | undefined }) {
  if (!live || live.services.length === 0) {
    return <span className="muted">Not configured</span>;
  }
  return (
    <span className="tag-row">
      {live.services.map((service) => (
        <Tag
          key={service.period}
          tone={!service.isEnabled ? 'neutral' : service.isOpenNow ? 'success' : 'warning'}
        >
          {PERIOD_SHORT[service.period]}
          {service.isEnabled ? (service.isOpenNow ? ' · open' : ' · closed') : ' · off'}
        </Tag>
      ))}
    </span>
  );
}

/** Canteen administration: activate / deactivate, pause / resume order-taking, create and edit. */
export function CanteensPage() {
  const api = useAdminApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const canteens = useResource(() => api.canteens(), [api, connectionEpoch]);
  const live = useResource(() => api.browseCanteens(), [api, connectionEpoch]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ canteen?: AdminCanteen } | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<AdminCanteen | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | AdminCanteen['status']>('ALL');

  // Staff can pause their own canteen; keep the list in sync.
  useServerEvent('canteen.status_changed', () => void canteens.reload());

  const update = async (canteen: AdminCanteen, patch: Partial<CanteenInput>, message: string) => {
    setBusy((b) => ({ ...b, [canteen.id]: true }));
    try {
      await api.updateCanteen(canteen.id, patch);
      await canteens.reload();
      toast(message);
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return false;
    } finally {
      setBusy((b) => ({ ...b, [canteen.id]: false }));
    }
  };

  const visible = (canteens.data ?? []).filter((canteen) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery =
      !needle ||
      canteen.name.toLowerCase().includes(needle) ||
      (canteen.location ?? '').toLowerCase().includes(needle);
    return matchesQuery && (statusFilter === 'ALL' || canteen.status === statusFilter);
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Canteens</h1>
          <p>
            Deactivated canteens are hidden from students. Paused canteens show their menu but take
            no orders.
          </p>
        </div>
        <Button icon={<IconPlus width={16} height={16} />} onClick={() => setEditing({})}>
          Add canteen
        </Button>
      </div>

      <div className="filters">
        <label className="inline-select">
          <span>Search</span>
          <Input
            aria-label="Search canteens"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or location"
          />
        </label>
        <label className="inline-select">
          <span>Status</span>
          <Select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          >
            <option value="ALL">All</option>
            <option value="ACCEPTING_ORDERS">Accepting</option>
            <option value="PAUSED">Paused</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </label>
      </div>

      <section className="section">
        {canteens.loading && !canteens.data ? (
          <SkeletonRows rows={5} />
        ) : canteens.error && !canteens.data ? (
          <ErrorState error={canteens.error} onRetry={() => void canteens.reload()} />
        ) : canteens.data && canteens.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Canteen</th>
                  <th>Status</th>
                  <th>Services</th>
                  <th>Hostels</th>
                  <th>Active staff</th>
                  <th>Menu items</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      No canteens match this search.
                    </td>
                  </tr>
                ) : null}
                {visible.map((canteen) => (
                  <tr key={canteen.id}>
                    <td>
                      <Link to={`/canteens/${canteen.id}`} className="item-name">
                        {canteen.name}
                      </Link>
                      <div className="muted small">
                        {[canteen.location, canteen.openingHours].filter(Boolean).join(' · ') ||
                          '—'}
                      </div>
                    </td>
                    <td>
                      <CanteenStatus canteen={canteen} />
                    </td>
                    <td>
                      <ServicePeriodTags live={live.data?.find((row) => row.id === canteen.id)} />
                    </td>
                    <td className="num">{canteen.counts.hostels}</td>
                    <td className="num">{canteen.counts.activeStaff}</td>
                    <td className="num">{canteen.counts.menuItems}</td>
                    <td>
                      <div className="row-actions">
                        {canteen.isActive ? (
                          <>
                            {canteen.isAcceptingOrders ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                icon={<IconPause width={14} height={14} />}
                                loading={busy[canteen.id]}
                                onClick={() =>
                                  void update(
                                    canteen,
                                    { isAcceptingOrders: false },
                                    `${canteen.name} paused`,
                                  )
                                }
                              >
                                Pause
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                icon={<IconPlay width={14} height={14} />}
                                loading={busy[canteen.id]}
                                onClick={() =>
                                  void update(
                                    canteen,
                                    { isAcceptingOrders: true },
                                    `${canteen.name} accepting orders`,
                                  )
                                }
                              >
                                Resume
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy[canteen.id]}
                              onClick={() => setConfirmDeactivate(canteen)}
                            >
                              Deactivate
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            loading={busy[canteen.id]}
                            onClick={() =>
                              void update(canteen, { isActive: true }, `${canteen.name} activated`)
                            }
                          >
                            Activate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<IconStore />}
            title="No canteens yet"
            action={<Button onClick={() => setEditing({})}>Add canteen</Button>}
          />
        )}
      </section>

      {editing ? (
        <CanteenFormModal
          canteen={editing.canteen}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            void canteens.reload();
            toast(created ? `${saved.name} created` : `${saved.name} updated`);
          }}
        />
      ) : null}
      {confirmDeactivate ? (
        <Modal
          title={`Deactivate ${confirmDeactivate.name}?`}
          onClose={() => setConfirmDeactivate(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDeactivate(null)}>
                Keep active
              </Button>
              <Button
                variant="danger"
                loading={busy[confirmDeactivate.id]}
                onClick={async () => {
                  if (
                    await update(
                      confirmDeactivate,
                      { isActive: false },
                      `${confirmDeactivate.name} deactivated`,
                    )
                  )
                    setConfirmDeactivate(null);
                }}
              >
                Deactivate
              </Button>
            </>
          }
        >
          <p>
            Students will no longer see this canteen and cannot order from it. Orders already paid
            can still be completed by staff.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

export function CanteenFormModal({
  canteen,
  onClose,
  onSaved,
}: {
  canteen?: Canteen | undefined;
  onClose: () => void;
  onSaved: (canteen: Canteen, created: boolean) => void;
}) {
  const api = useAdminApi();
  const [name, setName] = useState(canteen?.name ?? '');
  const [slug, setSlug] = useState(canteen?.slug ?? '');
  const [location, setLocation] = useState(canteen?.location ?? '');
  const [openingHours, setOpeningHours] = useState(canteen?.openingHours ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = 'Enter a name';
    if (slug.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()))
      local.slug = 'Use lowercase letters, digits and hyphens';
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    setError(null);
    const body: CanteenInput = {
      name: name.trim(),
      location: location.trim() || null,
      openingHours: openingHours.trim() || null,
      ...(slug.trim() ? { slug: slug.trim() } : {}),
    };
    try {
      const saved = canteen
        ? await api.updateCanteen(canteen.id, body)
        : await api.createCanteen(body);
      onSaved(saved, !canteen);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={canteen ? `Edit ${canteen.name}` : 'Add canteen'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="canteen-form" loading={busy}>
            {canteen ? 'Save changes' : 'Add canteen'}
          </Button>
        </>
      }
    >
      <form id="canteen-form" className="form" onSubmit={(e) => void submit(e)} noValidate>
        <FormError error={error} />
        <Field label="Name" error={errors.name}>
          {(p) => (
            <Input
              {...p}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field
          label="Slug (optional)"
          error={errors.slug}
          hint="Generated from the name when empty"
        >
          {(p) => (
            <Input
              {...p}
              value={slug}
              maxLength={80}
              onChange={(e) => setSlug(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <div className="form-row">
          <Field label="Location" error={errors.location}>
            {(p) => (
              <Input
                {...p}
                value={location}
                maxLength={200}
                onChange={(e) => setLocation(e.target.value)}
              />
            )}
          </Field>
          <Field label="Opening hours" error={errors.openingHours} hint="For example 21:00–03:00">
            {(p) => (
              <Input
                {...p}
                value={openingHours}
                maxLength={100}
                onChange={(e) => setOpeningHours(e.target.value)}
              />
            )}
          </Field>
        </div>
        {canteen ? null : (
          <p className="muted small">
            New canteens start active and accepting orders. Add a menu and staff before announcing
            it.
          </p>
        )}
      </form>
    </Modal>
  );
}
