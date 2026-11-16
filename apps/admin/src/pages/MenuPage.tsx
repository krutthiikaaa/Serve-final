import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  AdminMenuCategory,
  AdminMenuItem,
  MenuItemServiceConfig,
  ServicePeriod,
} from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  IconPlus,
  Input,
  Modal,
  Select,
  SkeletonRows,
  Tag,
  TextArea,
  errorMessage,
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
import { useAdminApi } from '../useAdminApi';

function periodPrice(item: AdminMenuItem, period: ServicePeriod) {
  return item.services.find((service) => service.period === period);
}

function priceCell(item: AdminMenuItem, period: ServicePeriod) {
  const service = periodPrice(item, period);
  return service ? formatRupees(service.pricePaise) : '—';
}

function availabilityCell(item: AdminMenuItem, period: ServicePeriod) {
  const service = periodPrice(item, period);
  if (!service) return '—';
  return service.isAvailable ? 'On' : 'Off';
}

/** Cross-canteen menu administration on the existing catalogue APIs. */
export function MenuPage() {
  const api = useAdminApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const canteens = useResource(() => api.canteens(), [api]);
  const [canteenId, setCanteenId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState<AdminMenuItem | 'new' | null>(null);

  useEffect(() => {
    const first = canteens.data?.[0];
    if (!canteenId && first) setCanteenId(first.id);
  }, [canteens.data, canteenId]);

  const catalogue = useResource(
    () => (canteenId ? api.menuCatalogue(canteenId) : Promise.resolve([])),
    [api, canteenId, connectionEpoch],
  );
  useServerEvents(
    [
      'menu.item_updated',
      'menu.item_price_changed',
      'menu.item_availability_changed',
      'menu.category_updated',
    ] as const,
    () => {
      if (canteenId) void catalogue.reload();
    },
  );

  const categories = useMemo(() => catalogue.data ?? [], [catalogue.data]);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return categories.flatMap((category) =>
      category.items
        .filter((item) => {
          if (categoryId && category.id !== categoryId) return false;
          if (query && !item.name.toLowerCase().includes(query)) return false;
          return true;
        })
        .map((item) => ({ item, category })),
    );
  }, [categories, categoryId, search]);

  const selectedCategory = categories.find((category) => category.id === categoryId);
  const selectedCanteen = canteens.data?.find((canteen) => canteen.id === canteenId);
  /** Each canteen sells in exactly its own period (Day or Night). */
  const period: ServicePeriod = selectedCanteen?.type ?? 'NIGHT';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Menu Management</h1>
          <p>Every canteen, Day or Night, has its own independent menu and prices.</p>
        </div>
        <Button
          icon={<IconPlus width={16} height={16} />}
          disabled={!canteenId || categories.length === 0}
          onClick={() => setEditing('new')}
        >
          Add item
        </Button>
      </div>

      <div className="filters">
        <label className="inline-select">
          <span>Canteen</span>
          <Select
            aria-label="Canteen"
            value={canteenId}
            onChange={(event) => {
              setCanteenId(event.target.value);
              setCategoryId('');
            }}
          >
            {(canteens.data ?? []).map((canteen) => (
              <option key={canteen.id} value={canteen.id}>
                {canteen.name} · {canteen.type === 'DAY' ? 'Day' : 'Night'}
              </option>
            ))}
          </Select>
        </label>
        {selectedCanteen ? <CanteenTypeBadge type={selectedCanteen.type} /> : null}
        <label className="inline-select">
          <span>Category</span>
          <Select
            aria-label="Category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="inline-select">
          <span>Search</span>
          <Input
            aria-label="Search menu items"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Item name"
          />
        </label>
        <Button
          variant="secondary"
          size="sm"
          disabled={!canteenId}
          onClick={() => setAddingCategory(true)}
        >
          Add category
        </Button>
        {selectedCategory ? (
          <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
            Rename category
          </Button>
        ) : null}
      </div>

      <section className="section">
        {canteens.loading && !canteens.data ? (
          <SkeletonRows rows={4} />
        ) : canteens.error && !canteens.data ? (
          <ErrorState error={canteens.error} onRetry={() => void canteens.reload()} />
        ) : !canteenId ? (
          <EmptyState title="No canteens yet" body="Create a canteen before adding a menu." />
        ) : catalogue.loading && !catalogue.data ? (
          <SkeletonRows rows={4} />
        ) : catalogue.error && !catalogue.data ? (
          <ErrorState error={catalogue.error} onRetry={() => void catalogue.reload()} />
        ) : categories.length === 0 ? (
          <EmptyState
            title="No menu yet"
            body="Add a category, then add items with Day and Night prices."
            action={
              <Button onClick={() => setAddingCategory(true)} disabled={!canteenId}>
                Add category
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState title="No matching items" body="Try another category or search." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="num">Price</th>
                  <th>Available</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, category }) => (
                  <tr key={item.id} className={item.isActive ? undefined : 'row-muted'}>
                    <td>
                      <span className="item-name">{item.name}</span>
                      {item.description ? (
                        <div className="muted small">{item.description}</div>
                      ) : null}
                      {!item.isActive ? <Tag>Inactive</Tag> : null}
                    </td>
                    <td>{category.name}</td>
                    <td className="num">{priceCell(item, period)}</td>
                    <td>{availabilityCell(item, period)}</td>
                    <td>
                      <div className="row-actions">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant={item.isActive ? 'danger' : 'secondary'}
                          onClick={() =>
                            void api
                              .updateMenuItem(item.id, { isActive: !item.isActive })
                              .then(() => catalogue.reload())
                              .then(() =>
                                toast(
                                  item.isActive
                                    ? `${item.name} deactivated`
                                    : `${item.name} activated`,
                                ),
                              )
                              .catch((err: unknown) => toast(errorMessage(err), 'error'))
                          }
                        >
                          {item.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {addingCategory && canteenId ? (
        <CategoryModal
          title="Add category"
          onClose={() => setAddingCategory(false)}
          onSubmit={(name) => api.createMenuCategory(canteenId, { name })}
          onSaved={async (name) => {
            setAddingCategory(false);
            await catalogue.reload();
            toast(`${name} added`);
          }}
        />
      ) : null}
      {renaming && selectedCategory ? (
        <CategoryModal
          title={`Rename ${selectedCategory.name}`}
          initialName={selectedCategory.name}
          onClose={() => setRenaming(false)}
          onSubmit={(name) => api.updateMenuCategory(selectedCategory.id, { name })}
          onSaved={async (name) => {
            setRenaming(false);
            await catalogue.reload();
            toast(`Category renamed to ${name}`);
          }}
        />
      ) : null}
      {editing && canteenId ? (
        <ItemModal
          canteenId={canteenId}
          period={period}
          categories={categories}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            await catalogue.reload();
            toast(message);
          }}
        />
      ) : null}
    </>
  );
}

function CategoryModal({
  title,
  initialName = '',
  onClose,
  onSubmit,
  onSaved,
}: {
  title: string;
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
  onSaved: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim());
      await onSaved(name.trim());
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="category-form" className="form" onSubmit={(event) => void submit(event)} noValidate>
        <FormError error={error} />
        <Field label="Name">
          {(props) => (
            <Input
              {...props}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

function ItemModal({
  canteenId,
  period,
  categories,
  item,
  onClose,
  onSaved,
}: {
  canteenId: string;
  period: ServicePeriod;
  categories: AdminMenuCategory[];
  item: AdminMenuItem | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const api = useAdminApi();
  const current = item ? periodPrice(item, period) : undefined;
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? categories[0]?.id ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(current ? paiseToRupeesInput(current.pricePaise) : '');
  const [available, setAvailable] = useState(current?.isAvailable ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    const paise = rupeesToPaise(price);
    if (!name.trim()) local.name = 'Enter an item name';
    if (!categoryId) local.categoryId = 'Choose a category';
    if (paise === null || paise <= 0) local.price = 'Enter a price greater than ₹0';
    setErrors(local);
    if (Object.keys(local).length > 0 || paise === null) return;
    setBusy(true);
    setError(null);
    try {
      if (!item) {
        // The backend prices a new item for its canteen's own period.
        const created = await api.createMenuItem(canteenId, {
          categoryId,
          name: name.trim(),
          description: description.trim() || null,
          pricePaise: paise,
          isAvailable: available,
        });
        await onSaved(`${created.name} added`);
        return;
      }
      await api.updateMenuItem(item.id, {
        categoryId,
        name: name.trim(),
        description: description.trim() || null,
      });
      const services: MenuItemServiceConfig[] = [
        { period, pricePaise: paise, isAvailable: available },
      ];
      await api.updateMenuItemServices(item.id, services);
      await onSaved(`${name.trim()} updated`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={item ? `Edit ${item.name}` : 'Add item'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="menu-item-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="menu-item-form"
        className="form"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <FormError error={error} />
        <Field label="Name" error={errors.name}>
          {(props) => (
            <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>
        <Field label="Category" error={errors.categoryId}>
          {(props) => (
            <Select
              {...props}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description">
          {(props) => (
            <TextArea
              {...props}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
        <Field label="Price (₹)" error={errors.price}>
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="0"
            />
          )}
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={available}
            onChange={(event) => setAvailable(event.target.checked)}
          />
          Available to order
        </label>
      </form>
    </Modal>
  );
}
