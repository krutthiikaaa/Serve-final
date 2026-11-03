import { useState, type FormEvent } from 'react';
import type { AdminMenuItem, MenuItemServiceConfig, ServicePeriod } from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  Modal,
  SkeletonRows,
  Tag,
  fieldErrors,
  formatRupees,
  paiseToRupeesInput,
  rupeesToPaise,
  useRealtime,
  useResource,
  useServerEvents,
  useToast,
} from '@serve/web-shared';
import { useAdminApi } from '../../useAdminApi';
import { PERIOD_LABEL } from '../../lib/warnings';

const PERIODS: ServicePeriod[] = ['DAY', 'NIGHT'];

function periodService(item: AdminMenuItem, period: ServicePeriod) {
  return item.services.find((service) => service.period === period);
}

export function MenuPricingSection({ canteenId }: { canteenId: string }) {
  const api = useAdminApi();
  const { connectionEpoch } = useRealtime();
  const [period, setPeriod] = useState<ServicePeriod>('NIGHT');
  const catalogue = useResource(
    () => api.menuCatalogue(canteenId),
    [api, canteenId, connectionEpoch],
  );
  const [editing, setEditing] = useState<AdminMenuItem | null>(null);

  useServerEvents(
    ['menu.item_updated', 'menu.item_price_changed', 'menu.item_availability_changed'] as const,
    () => {
      void catalogue.reload();
    },
  );

  const categories = catalogue.data ?? [];

  if (catalogue.loading && !catalogue.data) return <SkeletonRows rows={4} />;
  if (catalogue.error && !catalogue.data)
    return <ErrorState error={catalogue.error} onRetry={() => void catalogue.reload()} />;

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>Menu prices</h2>
          <p className="muted small">
            One catalogue — Day and Night prices are separate. Items are not duplicated.
          </p>
        </div>
        <div className="segmented" role="tablist" aria-label="Price period">
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
            </button>
          ))}
        </div>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          title="No menu yet"
          body="Staff assigned to this canteen can add items. You can then set Day and Night prices here."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>{PERIOD_LABEL[period]} price</th>
                <th>Availability</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.flatMap((category) =>
                category.items.map((item) => {
                  const priced = periodService(item, period);
                  return (
                    <tr key={item.id} className={item.isActive ? undefined : 'row-muted'}>
                      <td>
                        <div className="item-name">{item.name}</div>
                        <div className="muted small">{category.name}</div>
                      </td>
                      <td>
                        {priced ? (
                          formatRupees(priced.pricePaise)
                        ) : (
                          <Tag tone="warning">Not configured</Tag>
                        )}
                      </td>
                      <td>
                        {priced ? (
                          priced.isAvailable ? (
                            <Tag tone="success">Available</Tag>
                          ) : (
                            <Tag tone="neutral">Unavailable</Tag>
                          )
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>
                          Set prices
                        </Button>
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <ItemServicesModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await catalogue.reload();
          }}
        />
      ) : null}
    </section>
  );
}

function ItemServicesModal({
  item,
  onClose,
  onSaved,
}: {
  item: AdminMenuItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const api = useAdminApi();
  const toast = useToast();
  const day = periodService(item, 'DAY');
  const night = periodService(item, 'NIGHT');
  const [dayPrice, setDayPrice] = useState(day ? paiseToRupeesInput(day.pricePaise) : '');
  const [nightPrice, setNightPrice] = useState(night ? paiseToRupeesInput(night.pricePaise) : '');
  const [dayAvailable, setDayAvailable] = useState(day?.isAvailable ?? true);
  const [nightAvailable, setNightAvailable] = useState(night?.isAvailable ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    const services: MenuItemServiceConfig[] = [];
    const dayPaise = dayPrice.trim() ? rupeesToPaise(dayPrice) : null;
    const nightPaise = nightPrice.trim() ? rupeesToPaise(nightPrice) : null;
    if (dayPrice.trim()) {
      if (dayPaise === null || dayPaise <= 0) local.dayPrice = 'Enter a price greater than ₹0';
      else services.push({ period: 'DAY', pricePaise: dayPaise, isAvailable: dayAvailable });
    }
    if (nightPrice.trim()) {
      if (nightPaise === null || nightPaise <= 0) local.nightPrice = 'Enter a price greater than ₹0';
      else services.push({ period: 'NIGHT', pricePaise: nightPaise, isAvailable: nightAvailable });
    }
    if (services.length === 0) local.dayPrice = 'Set at least one period price';
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateMenuItemServices(item.id, services);
      toast(`Prices updated for ${item.name}`);
      await onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Prices for ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="item-services-form" loading={busy}>
            Save prices
          </Button>
        </>
      }
    >
      <form id="item-services-form" className="form" onSubmit={(e) => void submit(e)} noValidate>
        <FormError error={error} />
        <p className="muted small">
          Leave a price blank to keep that period unchanged. Empty Day or Night does not copy the
          other period’s price.
        </p>
        <div className="form-row">
          <Field
            label="Day price (₹)"
            error={errors.dayPrice}
            hint={day ? undefined : 'Not configured'}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={dayPrice}
                onChange={(e) => setDayPrice(e.target.value)}
                placeholder="Not set"
              />
            )}
          </Field>
          <Field
            label="Night price (₹)"
            error={errors.nightPrice}
            hint={night ? undefined : 'Not configured'}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={nightPrice}
                onChange={(e) => setNightPrice(e.target.value)}
                placeholder="Not set"
              />
            )}
          </Field>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={dayAvailable}
            onChange={(e) => setDayAvailable(e.target.checked)}
          />
          Available during Day
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={nightAvailable}
            onChange={(e) => setNightAvailable(e.target.checked)}
          />
          Available during Night
        </label>
      </form>
    </Modal>
  );
}
