import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AdminCanteen, Canteen, ServiceArea, ServicePeriod } from '@serve/contracts';
import {
  AvailabilityTag,
  Button,
  CanteenTypeBadge,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  IconEdit,
  IconPause,
  IconPlay,
  IconPlus,
  IconStore,
  Input,
  Modal,
  Select,
  SkeletonRows,
  errorMessage,
  fieldErrors,
  useRealtime,
  useResource,
  useServerEvent,
  useToast,
} from '@serve/web-shared';
import type { CanteenInput, CanteenPatch } from '../api/admin';
import { useAdminApi } from '../useAdminApi';
import { AreaScheduleStrip, OverrideModal, ScheduleModal } from './canteen/AreaSchedule';

/** A canteen's state in the shared vocabulary (see AVAILABILITY_LABEL). */
export function CanteenStatus({ canteen }: { canteen: Pick<Canteen, 'availability'> }) {
  return <AvailabilityTag state={canteen.availability.state} />;
}

export const TYPE_LABEL: Record<ServicePeriod, string> = { DAY: 'Day', NIGHT: 'Night' };
const TYPES: ServicePeriod[] = ['DAY', 'NIGHT'];

type Row = Canteen & Partial<Pick<AdminCanteen, 'counts' | 'staffAccount'>>;

/**
 * Canteens, grouped by service area. Each area has at most one Day and one
 * Night canteen and only one of them takes orders at a time; the switch is a
 * single server transaction (PostgreSQL also refuses two open canteens).
 */
export function CanteensPage() {
  const api = useAdminApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const areas = useResource(() => api.serviceAreas(), [api, connectionEpoch]);
  const canteens = useResource(() => api.canteens(), [api, connectionEpoch]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{
    canteen?: Row;
    preset?: { type: ServicePeriod; serviceAreaId: string };
  } | null>(null);
  const [addingArea, setAddingArea] = useState(false);
  const [scheduling, setScheduling] = useState<ServiceArea | null>(null);
  const [overriding, setOverriding] = useState<{
    area: ServiceArea;
    canteenId: string | null;
    canteenName: string | null;
  } | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<Row | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ServicePeriod>('ALL');

  const reload = () => {
    void areas.reload();
    void canteens.reload();
  };
  useServerEvent('canteen.status_changed', reload);
  useServerEvent('service_area.updated', reload);
  useServerEvent('canteen.payment_qr_updated', reload);
  useServerEvent('staff.canteen_assigned', reload);
  useServerEvent('staff.unassigned', reload);

  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await action();
      reload();
      toast(message);
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return false;
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const details = (id: string) => canteens.data?.find((row) => row.id === id);
  const needle = query.trim().toLowerCase();
  const matches = (canteen: Canteen, area: ServiceArea) =>
    (typeFilter === 'ALL' || canteen.type === typeFilter) &&
    (!needle ||
      canteen.name.toLowerCase().includes(needle) ||
      area.name.toLowerCase().includes(needle) ||
      area.hostels.some((hostel) => hostel.name.toLowerCase().includes(needle)));
  const visibleAreas = (areas.data ?? []).filter((area) =>
    !needle && typeFilter === 'ALL' ? true : area.canteens.some((c) => matches(c, area)),
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Canteens</h1>
          <p>
            Each service area has a Day and a Night canteen. Only one of them takes orders at a
            time.
          </p>
        </div>
        <div className="header-actions">
          <Button variant="secondary" onClick={() => setAddingArea(true)}>
            Add service area
          </Button>
          <Button icon={<IconPlus width={16} height={16} />} onClick={() => setEditing({})}>
            Add canteen
          </Button>
        </div>
      </div>

      <div className="filters">
        <label className="inline-select">
          <span>Search</span>
          <Input
            aria-label="Search canteens"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Canteen, area or hostel"
          />
        </label>
        <div className="segmented" role="group" aria-label="Filter by type">
          {(['ALL', ...TYPES] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={typeFilter === value ? 'active' : ''}
              aria-pressed={typeFilter === value}
              onClick={() => setTypeFilter(value)}
            >
              {value === 'ALL' ? 'All' : TYPE_LABEL[value]}
            </button>
          ))}
        </div>
      </div>

      {areas.loading && !areas.data ? (
        <SkeletonRows rows={5} />
      ) : areas.error && !areas.data ? (
        <ErrorState error={areas.error} onRetry={reload} />
      ) : visibleAreas.length === 0 ? (
        <EmptyState
          icon={<IconStore />}
          title={areas.data?.length ? 'No canteens match this search' : 'No canteens yet'}
          action={
            areas.data?.length ? null : <Button onClick={() => setEditing({})}>Add canteen</Button>
          }
        />
      ) : (
        <div className="area-list">
          {visibleAreas.map((area) => {
            const byType = (type: ServicePeriod) => area.canteens.find((c) => c.type === type);
            const switchKey = `area:${area.id}`;
            return (
              <section key={area.id} className="area-card" aria-labelledby={`area-${area.id}`}>
                <header className="area-head">
                  <div>
                    <h2 id={`area-${area.id}`}>{area.name}</h2>
                    <p className="muted small">
                      {area.hostels.length
                        ? area.hostels.map((hostel) => hostel.name).join(' · ')
                        : 'No hostels mapped yet'}
                    </p>
                  </div>
                  <div className="area-switch">
                    <span className="muted small" id={`switch-${area.id}`}>
                      Taking orders
                    </span>
                    <div className="segmented" role="group" aria-labelledby={`switch-${area.id}`}>
                      {TYPES.map((type) => {
                        const canteen = byType(type);
                        if (!canteen) return null;
                        const active = area.openCanteenId === canteen.id;
                        return (
                          <button
                            key={type}
                            type="button"
                            className={active ? 'active' : ''}
                            aria-pressed={active}
                            disabled={busy[switchKey] || !canteen.isActive || active}
                            title={canteen.isActive ? undefined : 'Activate this canteen first'}
                            onClick={() =>
                              area.schedule.autoSwitchEnabled
                                ? setOverriding({
                                    area,
                                    canteenId: canteen.id,
                                    canteenName: canteen.name,
                                  })
                                : void run(
                                    switchKey,
                                    () => api.setActiveService(area.id, canteen.id),
                                    `${canteen.name} is now taking orders`,
                                  )
                            }
                          >
                            {TYPE_LABEL[type]}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={area.openCanteenId === null ? 'active' : ''}
                        aria-pressed={area.openCanteenId === null}
                        disabled={busy[switchKey] || area.openCanteenId === null}
                        onClick={() =>
                          area.schedule.autoSwitchEnabled
                            ? setOverriding({ area, canteenId: null, canteenName: null })
                            : void run(
                                switchKey,
                                () => api.setActiveService(area.id, null),
                                `${area.name}: no canteen is taking orders`,
                              )
                        }
                      >
                        Neither
                      </button>
                    </div>
                  </div>
                </header>
                <AreaScheduleStrip
                  area={area}
                  busy={Boolean(busy[switchKey])}
                  onEdit={() => setScheduling(area)}
                  onRestore={() =>
                    void run(
                      switchKey,
                      () => api.restoreAutomatic(area.id),
                      `${area.name} follows its schedule again`,
                    )
                  }
                />

                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Canteen</th>
                        <th>Type</th>
                        <th>Availability</th>
                        <th>Staff account</th>
                        <th className="num">Menu items</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {TYPES.map((type) => {
                        const canteen = byType(type);
                        if (!canteen) {
                          return typeFilter === 'ALL' || typeFilter === type ? (
                            <tr key={type} className="row-missing">
                              <td colSpan={5} className="muted">
                                No {TYPE_LABEL[type].toLowerCase()} canteen in this area.
                              </td>
                              <td>
                                <div className="row-actions">
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    icon={<IconPlus width={14} height={14} />}
                                    onClick={() =>
                                      setEditing({ preset: { type, serviceAreaId: area.id } })
                                    }
                                  >
                                    Add {TYPE_LABEL[type]} canteen
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ) : null;
                        }
                        if (!matches(canteen, area)) return null;
                        const extra = details(canteen.id);
                        const row: Row = { ...canteen, ...extra };
                        return (
                          <tr key={canteen.id}>
                            <td>
                              <Link to={`/canteens/${canteen.id}`} className="item-name">
                                {canteen.name}
                              </Link>
                              <div className="muted small">
                                {[canteen.location, canteen.openingHours]
                                  .filter(Boolean)
                                  .join(' · ') || '—'}
                              </div>
                            </td>
                            <td>
                              <CanteenTypeBadge type={canteen.type} />
                            </td>
                            <td>
                              <AvailabilityTag state={canteen.availability.state} />
                            </td>
                            <td>
                              {extra?.staffAccount ? (
                                <span className="small">{extra.staffAccount.email}</span>
                              ) : (
                                <span className="muted small">Not assigned</span>
                              )}
                            </td>
                            <td className="num">{extra?.counts?.menuItems ?? '—'}</td>
                            <td>
                              <div className="row-actions">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon={<IconEdit width={14} height={14} />}
                                  onClick={() => setEditing({ canteen: row })}
                                  aria-label={`Edit ${canteen.name}`}
                                >
                                  Edit
                                </Button>
                                {canteen.isActive ? (
                                  <>
                                    {canteen.isPaused ? (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        icon={<IconPlay width={14} height={14} />}
                                        loading={busy[canteen.id]}
                                        onClick={() =>
                                          void run(
                                            canteen.id,
                                            () =>
                                              api.updateCanteen(canteen.id, { isPaused: false }),
                                            `${canteen.name}: pause lifted`,
                                          )
                                        }
                                      >
                                        Resume
                                      </Button>
                                    ) : canteen.isAcceptingOrders ? (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        icon={<IconPause width={14} height={14} />}
                                        loading={busy[canteen.id]}
                                        onClick={() =>
                                          void run(
                                            canteen.id,
                                            () => api.updateCanteen(canteen.id, { isPaused: true }),
                                            `${canteen.name} paused`,
                                          )
                                        }
                                      >
                                        Pause
                                      </Button>
                                    ) : null}
                                    <Button
                                      size="sm"
                                      variant="danger"
                                      disabled={busy[canteen.id]}
                                      onClick={() => setConfirmDeactivate(row)}
                                    >
                                      Deactivate
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    size="sm"
                                    loading={busy[canteen.id]}
                                    onClick={() =>
                                      void run(
                                        canteen.id,
                                        () => api.updateCanteen(canteen.id, { isActive: true }),
                                        `${canteen.name} activated`,
                                      )
                                    }
                                  >
                                    Activate
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editing ? (
        <CanteenFormModal
          canteen={editing.canteen}
          preset={editing.preset}
          areas={areas.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            reload();
            toast(created ? `${saved.name} created` : `${saved.name} updated`);
          }}
        />
      ) : null}
      {scheduling ? (
        <ScheduleModal
          area={scheduling}
          onClose={() => setScheduling(null)}
          onSaved={(saved) => {
            setScheduling(null);
            reload();
            toast(
              saved.schedule.autoSwitchEnabled
                ? `${saved.name} now switches automatically`
                : `${saved.name} schedule saved`,
            );
          }}
        />
      ) : null}
      {overriding ? (
        <OverrideModal
          area={overriding.area}
          canteenName={overriding.canteenName}
          busy={Boolean(busy[`area:${overriding.area.id}`])}
          onClose={() => setOverriding(null)}
          onConfirm={(until) => {
            const { area, canteenId, canteenName } = overriding;
            void run(
              `area:${area.id}`,
              () => api.setActiveService(area.id, canteenId, until),
              canteenName ? `${canteenName} is now taking orders` : `${area.name}: closed`,
            ).then((ok) => ok && setOverriding(null));
          }}
        />
      ) : null}
      {addingArea ? (
        <ServiceAreaModal
          onClose={() => setAddingArea(false)}
          onSaved={(area) => {
            setAddingArea(false);
            reload();
            toast(`${area.name} added`);
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
                    await run(
                      confirmDeactivate.id,
                      () => api.updateCanteen(confirmDeactivate.id, { isActive: false }),
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

function ServiceAreaModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (area: ServiceArea) => void;
}) {
  const api = useAdminApi();
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.createServiceArea(name.trim()));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Add service area"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="area-form" loading={busy} disabled={!name.trim()}>
            Add area
          </Button>
        </>
      }
    >
      <form id="area-form" className="form" onSubmit={(e) => void submit(e)} noValidate>
        <FormError error={error} />
        <Field label="Name" hint="For example the hostels it serves: “Krishna & Godavari”">
          {(p) => (
            <Input {...p} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
      </form>
    </Modal>
  );
}

const NEW_AREA = '__new__';

export function CanteenFormModal({
  canteen,
  preset,
  areas,
  onClose,
  onSaved,
}: {
  canteen?: Canteen | undefined;
  preset?: { type: ServicePeriod; serviceAreaId: string } | undefined;
  areas: ServiceArea[];
  onClose: () => void;
  onSaved: (canteen: Canteen, created: boolean) => void;
}) {
  const api = useAdminApi();
  const [name, setName] = useState(canteen?.name ?? '');
  const [type, setType] = useState<ServicePeriod | ''>(canteen?.type ?? preset?.type ?? '');
  const [areaId, setAreaId] = useState(
    canteen?.serviceArea.id ?? preset?.serviceAreaId ?? (areas.length ? '' : NEW_AREA),
  );
  const [areaName, setAreaName] = useState('');
  const [location, setLocation] = useState(canteen?.location ?? '');
  const [openingHours, setOpeningHours] = useState(canteen?.openingHours ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const takenTypes = new Set(
    areas
      .find((area) => area.id === areaId)
      ?.canteens.filter((row) => row.id !== canteen?.id)
      .map((row) => row.type) ?? [],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = 'Enter a name';
    if (!type) local.type = 'Choose Day or Night';
    if (!areaId) local.serviceAreaId = 'Choose a service area';
    if (areaId === NEW_AREA && !areaName.trim()) local.serviceAreaName = 'Name the new area';
    if (type && takenTypes.has(type))
      local.type = `This area already has a ${TYPE_LABEL[type].toLowerCase()} canteen`;
    setErrors(local);
    if (Object.keys(local).length > 0 || !type) return;
    setBusy(true);
    setError(null);
    try {
      let saved: Canteen;
      if (canteen) {
        const patch: CanteenPatch = {
          name: name.trim(),
          type,
          location: location.trim() || null,
          openingHours: openingHours.trim() || null,
          ...(areaId !== canteen.serviceArea.id ? { serviceAreaId: areaId } : {}),
        };
        saved = await api.updateCanteen(canteen.id, patch);
      } else {
        const body: CanteenInput = {
          name: name.trim(),
          type,
          location: location.trim() || null,
          openingHours: openingHours.trim() || null,
          ...(areaId === NEW_AREA
            ? { serviceAreaName: areaName.trim() }
            : { serviceAreaId: areaId }),
        };
        saved = await api.createCanteen(body);
      }
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
        <fieldset className="choice-group">
          <legend>Canteen type</legend>
          <div className="choice-row">
            {TYPES.map((value) => (
              <label key={value} className={`choice${type === value ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="canteen-type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                />
                <CanteenTypeBadge type={value} />
                <span className="muted small">
                  {value === 'DAY' ? 'Daytime service' : 'Late-evening service'}
                </span>
              </label>
            ))}
          </div>
          {errors.type ? (
            <p className="field-error" role="alert">
              {errors.type}
            </p>
          ) : null}
        </fieldset>
        <Field label="Name" error={errors.name}>
          {(p) => (
            <Input
              {...p}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              placeholder="For example Krishna & Godavari Day Canteen"
            />
          )}
        </Field>
        <Field label="Service area" error={errors.serviceAreaId}>
          {(p) => (
            <Select {...p} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="" disabled>
                Choose an area
              </option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
              {canteen ? null : <option value={NEW_AREA}>New service area…</option>}
            </Select>
          )}
        </Field>
        {areaId === NEW_AREA ? (
          <Field label="New area name" error={errors.serviceAreaName}>
            {(p) => (
              <Input
                {...p}
                value={areaName}
                maxLength={120}
                onChange={(e) => setAreaName(e.target.value)}
              />
            )}
          </Field>
        ) : null}
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
          <Field label="Opening hours" error={errors.openingHours} hint="Shown to students">
            {(p) => (
              <Input
                {...p}
                value={openingHours}
                maxLength={100}
                onChange={(e) => setOpeningHours(e.target.value)}
                placeholder={type === 'DAY' ? '8:00 AM – 8:00 PM' : '9:00 PM – 3:00 AM'}
              />
            )}
          </Field>
        </div>
        {canteen ? null : (
          <p className="muted small">
            A new canteen takes orders only if no other canteen in its area is. Use the area’s
            “Taking orders” switch to change that.
          </p>
        )}
      </form>
    </Modal>
  );
}
