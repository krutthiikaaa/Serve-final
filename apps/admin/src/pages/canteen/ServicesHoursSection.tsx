import { useEffect, useMemo, useState } from 'react';
import type {
  AdminCanteenDetail,
  AdminCanteenService,
  AdminOperatingSchedule,
  PublicCanteen,
  ScheduleOverride,
  ServicePeriod,
} from '@serve/contracts';
import {
  Button,
  EmptyState,
  Field,
  FormError,
  Select,
  Tag,
  errorMessage,
  useToast,
} from '@serve/web-shared';
import { TimeSelect } from '../../components/TimeSelect';
import { useAdminApi } from '../../useAdminApi';
import { WEEKDAYS, formatWindow } from '../../lib/time';
import { OVERRIDE_LABEL, PERIOD_LABEL, serviceStatus } from '../../lib/warnings';

const PERIODS: ServicePeriod[] = ['DAY', 'NIGHT'];

type DayDraft = {
  enabled: boolean;
  opensAtMinutes: number;
  closesAtMinutes: number;
};

const defaultDay = (): DayDraft => ({
  enabled: false,
  opensAtMinutes: 9 * 60,
  closesAtMinutes: 17 * 60,
});

function draftsFrom(service: AdminCanteenService | undefined): Record<number, DayDraft> {
  const drafts: Record<number, DayDraft> = {};
  for (const day of WEEKDAYS) {
    const row = service?.schedules.find((schedule) => schedule.weekday === day.weekday);
    drafts[day.weekday] = row
      ? {
          enabled: true,
          opensAtMinutes: row.opensAtMinutes,
          closesAtMinutes: row.closesAtMinutes,
        }
      : defaultDay();
  }
  return drafts;
}

function ServiceStatusTag({
  service,
  live,
}: {
  service: AdminCanteenService | undefined;
  live: PublicCanteen | undefined;
}) {
  const status = serviceStatus(service, live);
  return <Tag tone={status.tone}>{status.label}</Tag>;
}

export function ServicesHoursSection({
  canteenId,
  detail,
  live,
  onUpdated,
}: {
  canteenId: string;
  detail: AdminCanteenDetail;
  live: PublicCanteen | undefined;
  onUpdated: () => Promise<void>;
}) {
  const api = useAdminApi();
  const toast = useToast();
  const [period, setPeriod] = useState<ServicePeriod>('NIGHT');
  const service = (detail.services ?? []).find((row) => row.period === period);
  const [enabled, setEnabled] = useState(service?.isEnabled ?? false);
  const [override, setOverride] = useState<ScheduleOverride>(service?.override ?? 'AUTO');
  const [days, setDays] = useState<Record<number, DayDraft>>(() => draftsFrom(service));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setEnabled(service?.isEnabled ?? false);
    setOverride(service?.override ?? 'AUTO');
    setDays(draftsFrom(service));
    setError(null);
  }, [service, period, detail]);

  const configuredPeriods = useMemo(
    () => new Set((detail.services ?? []).map((row) => row.period)),
    [detail.services],
  );

  const patchDay = (weekday: number, patch: Partial<DayDraft>) => {
    setDays((current) => ({ ...current, [weekday]: { ...current[weekday]!, ...patch } }));
  };

  const saveService = async () => {
    setBusy('service');
    setError(null);
    try {
      await api.updateCanteenServices(canteenId, [
        { period, isEnabled: enabled, override },
      ]);
      await onUpdated();
      toast(`${PERIOD_LABEL[period]} service saved`);
    } catch (err) {
      setError(err);
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const saveHours = async () => {
    if (!service) {
      setError('Save the service first, then add weekly hours.');
      return;
    }
    const schedules: AdminOperatingSchedule[] = WEEKDAYS.flatMap((day) => {
      const draft = days[day.weekday];
      if (!draft?.enabled) return [];
      return [
        {
          weekday: day.weekday,
          opensAtMinutes: draft.opensAtMinutes,
          closesAtMinutes: draft.closesAtMinutes,
        },
      ];
    });
    setBusy('hours');
    setError(null);
    try {
      await api.updateCanteenSchedule(canteenId, period, schedules);
      await onUpdated();
      toast(`${PERIOD_LABEL[period]} hours saved`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const enableMissing = async () => {
    setBusy('create');
    setError(null);
    try {
      await api.updateCanteenServices(canteenId, [
        { period, isEnabled: true, override: 'AUTO' },
      ]);
      await onUpdated();
      toast(`${PERIOD_LABEL[period]} service added`);
    } catch (err) {
      setError(err);
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2>Day and night services</h2>
        <div className="segmented" role="tablist" aria-label="Service period">
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={period === value}
              className={period === value ? 'active' : ''}
              onClick={() => setPeriod(value)}
            >
              {PERIOD_LABEL[value]}
              {configuredPeriods.has(value) ? null : (
                <span className="muted"> · off</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="section-body">
        <FormError error={error} />
        {!service ? (
          <EmptyState
            title={`${PERIOD_LABEL[period]} service is not configured`}
            body="This canteen does not have this period yet. Enabling it does not invent opening hours — add a weekly schedule afterwards, or force it open."
            action={
              <Button loading={busy === 'create'} onClick={() => void enableMissing()}>
                Add {PERIOD_LABEL[period]} service
              </Button>
            }
          />
        ) : (
          <div className="form">
            <div className="service-status-row">
              <ServiceStatusTag service={service} live={live} />
              {service.schedules.length === 0 ? (
                <span className="muted small">No weekly hours saved</span>
              ) : (
                <span className="muted small">{service.schedules.length} day(s) with hours</span>
              )}
            </div>

            <label className="switch">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="switch-track" />
              {PERIOD_LABEL[period]} service enabled
            </label>

            <Field
              label="Hours mode"
              hint="Automatic follows the weekly schedule. Forced open or closed ignores the clock until you switch back."
            >
              {(p) => (
                <Select
                  {...p}
                  value={override}
                  onChange={(e) => setOverride(e.target.value as ScheduleOverride)}
                >
                  {(Object.keys(OVERRIDE_LABEL) as ScheduleOverride[]).map((value) => (
                    <option key={value} value={value}>
                      {OVERRIDE_LABEL[value]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div className="row-actions start">
              <Button loading={busy === 'service'} disabled={!!busy} onClick={() => void saveService()}>
                Save service
              </Button>
            </div>

            <h3 className="subheading">Weekly hours</h3>
            <p className="muted small">
              Times are shown in 12-hour format and sent to the server as minutes from midnight.
              Overnight windows close the next morning.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Open</th>
                    <th>Close</th>
                    <th>Window</th>
                  </tr>
                </thead>
                <tbody>
                  {WEEKDAYS.map((day) => {
                    const draft = days[day.weekday] ?? defaultDay();
                    return (
                      <tr key={day.weekday} className={draft.enabled ? undefined : 'row-muted'}>
                        <td>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={draft.enabled}
                              onChange={(e) => patchDay(day.weekday, { enabled: e.target.checked })}
                            />
                            {day.label}
                          </label>
                        </td>
                        <td>
                          <TimeSelect
                            aria-label={`${day.label} opening time`}
                            value={draft.opensAtMinutes}
                            onChange={(opensAtMinutes) => patchDay(day.weekday, { opensAtMinutes })}
                          />
                        </td>
                        <td>
                          <TimeSelect
                            aria-label={`${day.label} closing time`}
                            value={draft.closesAtMinutes}
                            onChange={(closesAtMinutes) => patchDay(day.weekday, { closesAtMinutes })}
                          />
                        </td>
                        <td className="muted small">
                          {draft.enabled
                            ? formatWindow(draft.opensAtMinutes, draft.closesAtMinutes)
                            : 'Closed'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row-actions start">
              <Button
                variant="secondary"
                loading={busy === 'hours'}
                disabled={!!busy}
                onClick={() => void saveHours()}
              >
                Save hours
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
