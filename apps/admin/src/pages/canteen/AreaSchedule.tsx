import { useMemo, useState, type FormEvent } from 'react';
import type { AreaTarget, ServiceArea } from '@serve/contracts';
import {
  Button,
  Field,
  FormError,
  IconClock,
  Input,
  Modal,
  Select,
  Tag,
  errorMessage,
  fieldErrors,
} from '@serve/web-shared';
import type { AreaScheduleInput, OverrideUntil } from '../../api/admin';
import { useAdminApi } from '../../useAdminApi';

const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const TARGET_LABEL: Record<AreaTarget, string> = {
  DAY: 'Day canteen',
  NIGHT: 'Night canteen',
  NONE: 'Closed',
};

/** "18:00 today", "06:00 tomorrow", "Wed 07:00" — in the area's own time zone. */
export function areaClock(iso: string, timezone: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  const day = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  if (day(at) === day(now)) return `${time} today`;
  if (day(at) === day(new Date(now.getTime() + 86_400_000))) return `${time} tomorrow`;
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short' }).format(
    at,
  );
  return `${weekday} ${time}`;
}

const hoursText = (hours: { opensAt: string; closesAt: string } | null) =>
  hours ? `${hours.opensAt}–${hours.closesAt}` : 'No service';

/**
 * How an area decides which canteen is on duty: automatic (schedule),
 * a manual override of the schedule, or manual switching.
 */
export function AreaScheduleStrip({
  area,
  busy,
  onEdit,
  onRestore,
}: {
  area: ServiceArea;
  busy: boolean;
  onEdit: () => void;
  onRestore: () => void;
}) {
  const { schedule, mode, override, nextTransition } = area;
  return (
    <div className="area-schedule" aria-label={`${area.name} schedule`} role="group">
      <div className="area-schedule-main">
        {mode === 'AUTOMATIC' ? (
          <Tag tone="success">Automatic</Tag>
        ) : mode === 'MANUAL_OVERRIDE' ? (
          <Tag tone="warning">Manual override</Tag>
        ) : (
          <Tag tone="neutral">Manual</Tag>
        )}
        <span className="small">
          <span className="muted">Day</span> {hoursText(schedule.day)}
          <span className="muted"> · Night</span> {hoursText(schedule.night)}
          <span className="muted"> · {schedule.timezone}</span>
        </span>
      </div>
      <p className="muted small area-schedule-note">
        {mode === 'MANUAL_OVERRIDE' && override
          ? `${TARGET_LABEL[override.target]} set by an admin ${
              override.until
                ? `until ${areaClock(override.until, schedule.timezone)}`
                : 'until automatic switching is restored'
            }. The schedule resumes after that.`
          : mode === 'AUTOMATIC' && nextTransition
            ? `Follows the schedule. Next: ${
                nextTransition.target === 'NONE'
                  ? 'closes'
                  : `${TARGET_LABEL[nextTransition.target]} on duty`
              } at ${areaClock(nextTransition.at, schedule.timezone)}.`
            : 'Automatic switching is off. Use the switch to choose which canteen takes orders.'}
      </p>
      <div className="area-schedule-actions">
        {mode === 'MANUAL_OVERRIDE' ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={onRestore}>
            Restore automatic
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon={<IconClock width={14} height={14} />}
          onClick={onEdit}
        >
          Edit schedule
        </Button>
      </div>
    </div>
  );
}

function timeZones(current: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: 'timeZone') => string[] };
  const zones = intl.supportedValuesOf?.('timeZone') ?? [DEFAULT_TIMEZONE, 'UTC'];
  return [...new Set([DEFAULT_TIMEZONE, current, ...zones])];
}

/** Day/Night hours, time zone and automatic switching for one area. */
export function ScheduleModal({
  area,
  onClose,
  onSaved,
}: {
  area: ServiceArea;
  onClose: () => void;
  onSaved: (area: ServiceArea) => void;
}) {
  const api = useAdminApi();
  const initial = area.schedule;
  const [auto, setAuto] = useState(initial.autoSwitchEnabled);
  const [timezone, setTimezone] = useState(initial.timezone || DEFAULT_TIMEZONE);
  const [dayOpens, setDayOpens] = useState(initial.day?.opensAt ?? '');
  const [dayCloses, setDayCloses] = useState(initial.day?.closesAt ?? '');
  const [nightOpens, setNightOpens] = useState(initial.night?.opensAt ?? '');
  const [nightCloses, setNightCloses] = useState(initial.night?.closesAt ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const zones = useMemo(() => timeZones(initial.timezone), [initial.timezone]);
  const errors = fieldErrors(error);
  const hours = (opensAt: string, closesAt: string) =>
    opensAt || closesAt ? { opensAt, closesAt } : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body: AreaScheduleInput = {
      autoSwitchEnabled: auto,
      timezone,
      day: hours(dayOpens, dayCloses),
      night: hours(nightOpens, nightCloses),
    };
    try {
      onSaved(await api.updateAreaSchedule(area.id, body));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const dayError = errors.dayOpensAtMinutes ?? errors.dayClosesAtMinutes ?? errors.day;
  const nightError = errors.nightOpensAtMinutes ?? errors.nightClosesAtMinutes ?? errors.night;
  return (
    <Modal
      title={`${area.name} schedule`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="area-schedule-form" loading={saving}>
            Save schedule
          </Button>
        </>
      }
    >
      <form id="area-schedule-form" className="form" onSubmit={(e) => void submit(e)} noValidate>
        <FormError error={error && !Object.keys(errors).length ? errorMessage(error) : null} />
        <label className="switch">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span className="switch-track" />
          Switch automatically
        </label>
        <p className="muted small">
          The server puts the Day or Night canteen on duty at these times. A pause set by staff is
          never lifted by the schedule.
        </p>
        {errors.autoSwitchEnabled ? (
          <p className="field-error" role="alert">
            {errors.autoSwitchEnabled}
          </p>
        ) : null}
        <fieldset className="choice-group">
          <legend>Day canteen hours</legend>
          <div className="form-row">
            <Field label="Day opens" error={dayError}>
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  value={dayOpens}
                  onChange={(e) => setDayOpens(e.target.value)}
                />
              )}
            </Field>
            <Field label="Day closes">
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  value={dayCloses}
                  onChange={(e) => setDayCloses(e.target.value)}
                />
              )}
            </Field>
          </div>
        </fieldset>
        <fieldset className="choice-group">
          <legend>Night canteen hours</legend>
          <div className="form-row">
            <Field label="Night opens" error={nightError}>
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  value={nightOpens}
                  onChange={(e) => setNightOpens(e.target.value)}
                />
              )}
            </Field>
            <Field label="Night closes" hint="May be after midnight">
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  value={nightCloses}
                  onChange={(e) => setNightCloses(e.target.value)}
                />
              )}
            </Field>
          </div>
        </fieldset>
        <Field label="Time zone" error={errors.timezone}>
          {(p) => (
            <Select {...p} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="muted small">
          Leave both times empty for no service. Between the windows neither canteen takes orders.
        </p>
      </form>
    </Modal>
  );
}

/**
 * Confirms a manual switch on an area that follows its schedule, and asks how
 * long the choice should hold.
 */
export function OverrideModal({
  area,
  canteenName,
  busy,
  onClose,
  onConfirm,
}: {
  area: ServiceArea;
  /** The canteen to put on duty, or null for "neither". */
  canteenName: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (until: OverrideUntil) => void;
}) {
  const [choice, setChoice] = useState<'NEXT_TRANSITION' | 'UNTIL_RESTORED' | 'AT'>(
    'NEXT_TRANSITION',
  );
  const [at, setAt] = useState('');
  const next = area.nextTransition;
  const invalidAt = choice === 'AT' && (!at || Number.isNaN(new Date(at).getTime()));
  const options = [
    {
      value: 'NEXT_TRANSITION' as const,
      label: next
        ? `Until the next scheduled change (${areaClock(next.at, area.schedule.timezone)})`
        : 'Until the next scheduled change',
    },
    { value: 'UNTIL_RESTORED' as const, label: 'Until I restore automatic switching' },
    { value: 'AT' as const, label: 'Until a time I choose' },
  ];
  return (
    <Modal
      title="Override the schedule?"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={invalidAt}
            onClick={() =>
              onConfirm(
                choice === 'AT' ? new Date(at).toISOString() : (choice satisfies OverrideUntil),
              )
            }
          >
            Override
          </Button>
        </>
      }
    >
      <p>
        {canteenName
          ? `${canteenName} will take orders for ${area.name}.`
          : `No canteen will take orders for ${area.name}.`}{' '}
        {area.name} switches automatically; this manual choice holds:
      </p>
      <fieldset className="choice-group">
        <legend className="sr-only">Override duration</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className={`choice${choice === option.value ? ' selected' : ''}`}
          >
            <input
              type="radio"
              name="override-until"
              value={option.value}
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      {choice === 'AT' ? (
        <Field label="Override ends" hint="In this device’s local time">
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          )}
        </Field>
      ) : null}
    </Modal>
  );
}
