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
  CanteenTypeBadge,
} from '@serve/web-shared';
import { useAdminApi } from '../../useAdminApi';
import { PERIOD_LABEL } from '../../lib/warnings';

function periodService(item: AdminMenuItem, period: ServicePeriod) {
  return item.services.find((service) => service.period === period);
}

export function MenuPricingSection({
  canteenId,
  canteenType,
}: {
  canteenId: string;
  canteenType: ServicePeriod;
}) {
  const api = useAdminApi();
  const { connectionEpoch } = useRealtime();
  const period = canteenType;
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
            Prices students pay at this {PERIOD_LABEL[period].toLowerCase()} canteen.
          </p>
        </div>
        <CanteenTypeBadge type={period} />
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
                          Set price
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
          period={period}
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
  period,
  onClose,
  onSaved,
}: {
  item: AdminMenuItem;
  period: ServicePeriod;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const api = useAdminApi();
  const toast = useToast();
  const current = periodService(item, period);
  const [price, setPrice] = useState(current ? paiseToRupeesInput(current.pricePaise) : '');
  const [available, setAvailable] = useState(current?.isAvailable ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const paise = rupeesToPaise(price);
    if (paise === null || paise <= 0) {
      setErrors({ price: 'Enter a price greater than ₹0' });
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      const services: MenuItemServiceConfig[] = [
        { period, pricePaise: paise, isAvailable: available },
      ];
      await api.updateMenuItemServices(item.id, services);
      toast(`Price updated for ${item.name}`);
      await onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Price for ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="item-services-form" loading={busy}>
            Save price
          </Button>
        </>
      }
    >
      <form id="item-services-form" className="form" onSubmit={(e) => void submit(e)} noValidate>
        <FormError error={error} />
        <Field label="Price (₹)" error={errors.price} hint={current ? undefined : 'Not set yet'}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Not set"
            />
          )}
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => setAvailable(e.target.checked)}
          />
          Available to order
        </label>
      </form>
    </Modal>
  );
}
