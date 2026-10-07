import { useState, type FormEvent } from 'react';
import type { Category, CategoryWithItems, MenuItem } from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  IconEdit,
  IconPlus,
  IconUtensils,
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
} from '@serve/web-shared';
import { useStaffApi } from '../useStaffApi';

const MIN_PRICE_PAISE = 100;
const MAX_PRICE_PAISE = 1_000_000;

/** Menu management for the assigned canteen. Prices are typed in rupees and sent as integer paise. */
export function MenuPage() {
  const api = useStaffApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const menu = useResource(() => api.menu(), [api, connectionEpoch]);
  const [itemModal, setItemModal] = useState<{ item?: MenuItem; categoryId?: string } | null>(null);
  const [categoryModal, setCategoryModal] = useState<{ category?: Category } | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  // Changes by a colleague (or an admin) show up without a manual refresh.
  useServerEvents(
    [
      'menu.item_updated',
      'menu.item_price_changed',
      'menu.item_availability_changed',
      'menu.category_updated',
    ] as const,
    () => {
      void menu.reload();
    },
  );

  const replaceItem = (item: MenuItem) =>
    menu.setData((categories) =>
      categories?.map((c) => ({
        ...c,
        items: c.items.some((i) => i.id === item.id)
          ? c.items.map((i) => (i.id === item.id ? item : i))
          : c.items,
      })),
    );

  const runItem = async (item: MenuItem, action: () => Promise<MenuItem>, success: string) => {
    setPending((p) => ({ ...p, [item.id]: true }));
    try {
      replaceItem(await action());
      toast(success);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setPending((p) => ({ ...p, [item.id]: false }));
    }
  };

  const toggleCategory = async (category: CategoryWithItems) => {
    setPending((p) => ({ ...p, [category.id]: true }));
    try {
      await api.updateCategory(category.id, { isActive: !category.isActive });
      await menu.reload();
      toast(
        category.isActive
          ? `${category.name} hidden from students`
          : `${category.name} visible to students`,
      );
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setPending((p) => ({ ...p, [category.id]: false }));
    }
  };

  const categories = menu.data ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Menu</h1>
          <p>
            Unavailable items stay visible to students but cannot be ordered. Disabled items are
            hidden.
          </p>
        </div>
        <div className="header-actions">
          <Button
            variant="secondary"
            icon={<IconPlus width={16} height={16} />}
            onClick={() => setCategoryModal({})}
          >
            Add category
          </Button>
          <Button
            icon={<IconPlus width={16} height={16} />}
            disabled={categories.length === 0}
            onClick={() => setItemModal({})}
          >
            Add item
          </Button>
        </div>
      </div>

      {menu.loading && !menu.data ? (
        <SkeletonRows rows={6} />
      ) : menu.error && !menu.data ? (
        <ErrorState error={menu.error} onRetry={() => void menu.reload()} />
      ) : categories.length === 0 ? (
        <section className="section">
          <EmptyState
            icon={<IconUtensils />}
            title="No menu yet"
            body="Start with a category, then add items to it."
            action={<Button onClick={() => setCategoryModal({})}>Add category</Button>}
          />
        </section>
      ) : (
        categories.map((category) => (
          <section
            key={category.id}
            className={`section${category.isActive ? '' : ' section-muted'}`}
            aria-label={category.name}
          >
            <div className="section-header">
              <div className="section-title">
                <h2>{category.name}</h2>
                <span className="muted small">{category.items.length} items</span>
                {category.isActive ? null : <Tag tone="neutral">Hidden</Tag>}
              </div>
              <div className="row-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<IconPlus width={14} height={14} />}
                  onClick={() => setItemModal({ categoryId: category.id })}
                >
                  Item
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<IconEdit width={14} height={14} />}
                  onClick={() => setCategoryModal({ category })}
                  aria-label={`Edit ${category.name}`}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending[category.id]}
                  onClick={() => void toggleCategory(category)}
                >
                  {category.isActive ? 'Hide' : 'Show'}
                </Button>
              </div>
            </div>
            {category.items.length === 0 ? (
              <p className="section-body muted">No items in this category.</p>
            ) : (
              <div className="table-wrap">
                <table className="table menu-table">
                  <colgroup>
                    <col />
                    <col className="col-price" />
                    <col className="col-status" />
                    <col className="col-available" />
                    <col className="col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Price</th>
                      <th>Status</th>
                      <th>Available</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {category.items.map((item) => (
                      <tr key={item.id} className={item.isActive ? '' : 'row-muted'}>
                        <td>
                          <div className="item-name">{item.name}</div>
                          {item.description ? (
                            <div className="muted small">{item.description}</div>
                          ) : null}
                        </td>
                        <td className="num">{formatRupees(item.pricePaise)}</td>
                        <td>
                          <AvailabilityTag item={item} />
                        </td>
                        <td>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={item.isAvailable}
                              disabled={!item.isActive || pending[item.id]}
                              onChange={(e) =>
                                void runItem(
                                  item,
                                  () => api.setAvailability(item.id, e.target.checked),
                                  e.target.checked
                                    ? `${item.name} is available`
                                    : `${item.name} marked unavailable`,
                                )
                              }
                              aria-label={`${item.name} available`}
                            />
                            <span className="switch-track" aria-hidden />
                          </label>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<IconEdit width={14} height={14} />}
                              onClick={() => setItemModal({ item })}
                              aria-label={`Edit ${item.name}`}
                            >
                              Edit
                            </Button>
                            {item.isActive ? (
                              <Button
                                size="sm"
                                variant="danger"
                                loading={pending[item.id]}
                                onClick={() =>
                                  void runItem(
                                    item,
                                    () => api.disableItem(item.id),
                                    `${item.name} disabled`,
                                  )
                                }
                              >
                                Disable
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={pending[item.id]}
                                onClick={() =>
                                  void runItem(
                                    item,
                                    () => api.updateItem(item.id, { isActive: true }),
                                    `${item.name} enabled`,
                                  )
                                }
                              >
                                Enable
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      )}

      {itemModal ? (
        <ItemModal
          categories={categories}
          item={itemModal.item}
          defaultCategoryId={itemModal.categoryId}
          onClose={() => setItemModal(null)}
          onSaved={(saved, created) => {
            setItemModal(null);
            void menu.reload();
            toast(created ? `${saved.name} added` : `${saved.name} updated`);
          }}
        />
      ) : null}
      {categoryModal ? (
        <CategoryModal
          category={categoryModal.category}
          onClose={() => setCategoryModal(null)}
          onSaved={(saved, created) => {
            setCategoryModal(null);
            void menu.reload();
            toast(created ? `${saved.name} created` : `${saved.name} updated`);
          }}
        />
      ) : null}
    </>
  );
}

export function AvailabilityTag({ item }: { item: MenuItem }) {
  if (item.availability === 'INACTIVE')
    return <Tag tone="neutral">{item.isActive ? 'Hidden' : 'Disabled'}</Tag>;
  if (item.availability === 'UNAVAILABLE') return <Tag tone="warning">Unavailable</Tag>;
  return <Tag tone="success">Available</Tag>;
}

/** Validates a rupee price string. Returns paise or an error message. */
export function parsePrice(input: string): { paise: number } | { error: string } {
  const paise = rupeesToPaise(input);
  if (paise === null) return { error: 'Enter a price in rupees, e.g. 120 or 99.50' };
  if (paise < MIN_PRICE_PAISE) return { error: 'Price must be at least ₹1' };
  if (paise > MAX_PRICE_PAISE) return { error: 'Price must be at most ₹10,000' };
  return { paise };
}

function ItemModal({
  categories,
  item,
  defaultCategoryId,
  onClose,
  onSaved,
}: {
  categories: CategoryWithItems[];
  item?: MenuItem | undefined;
  defaultCategoryId?: string | undefined;
  onClose: () => void;
  onSaved: (item: MenuItem, created: boolean) => void;
}) {
  const api = useStaffApi();
  const [categoryId, setCategoryId] = useState(
    item?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '',
  );
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(item ? paiseToRupeesInput(item.pricePaise) : '');
  const [available, setAvailable] = useState(item?.isAvailable ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = 'Enter a name';
    const parsed = parsePrice(price);
    if ('error' in parsed) local.pricePaise = parsed.error;
    if (!categoryId) local.categoryId = 'Choose a category';
    setErrors(local);
    if (Object.keys(local).length > 0 || 'error' in parsed) return;

    setBusy(true);
    setError(null);
    try {
      const body = {
        categoryId,
        name: name.trim(),
        description: description.trim() || null,
        pricePaise: parsed.paise,
      };
      const saved = item
        ? await api.updateItem(item.id, body)
        : await api.createItem({ ...body, isAvailable: available });
      onSaved(saved, !item);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={item ? `Edit ${item.name}` : 'Add menu item'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" loading={busy}>
            {item ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      <form id="item-form" className="form" onSubmit={(e) => void submit(e)} noValidate>
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
        <div className="form-row">
          <Field label="Category" error={errors.categoryId}>
            {(p) => (
              <Select {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isActive ? '' : ' (hidden)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Price (₹)" error={errors.pricePaise} hint="In rupees, e.g. 120 or 99.50">
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
              />
            )}
          </Field>
        </div>
        <Field label="Description (optional)" error={errors.description}>
          {(p) => (
            <TextArea
              {...p}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        {item ? null : (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={available}
              onChange={(e) => setAvailable(e.target.checked)}
            />
            Available to order now
          </label>
        )}
      </form>
    </Modal>
  );
}

function CategoryModal({
  category,
  onClose,
  onSaved,
}: {
  category?: Category | undefined;
  onClose: () => void;
  onSaved: (c: Category, created: boolean) => void;
}) {
  const api = useStaffApi();
  const [name, setName] = useState(category?.name ?? '');
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = 'Enter a name';
    const order = Number(sortOrder);
    if (!/^\d+$/.test(sortOrder.trim()) || order > 10_000)
      local.sortOrder = 'Use a whole number from 0 to 10000';
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), sortOrder: order };
      const saved = category
        ? await api.updateCategory(category.id, body)
        : await api.createCategory(body);
      onSaved(saved, !category);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={category ? `Edit ${category.name}` : 'Add category'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" loading={busy}>
            {category ? 'Save changes' : 'Add category'}
          </Button>
        </>
      }
    >
      <form id="category-form" className="form" onSubmit={(e) => void submit(e)} noValidate>
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
        <Field label="Display order" error={errors.sortOrder} hint="Lower numbers appear first">
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
