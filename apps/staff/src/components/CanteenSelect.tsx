import type { Canteen } from '@serve/contracts';
import { Field, Select, useResource } from '@serve/web-shared';
import { useStaffApi } from '../useStaffApi';

export function CanteenSelect({
  value,
  onChange,
  exclude,
  label = 'Canteen',
}: {
  value: string;
  onChange: (id: string) => void;
  exclude?: string | null;
  label?: string;
}) {
  const api = useStaffApi();
  const canteens = useResource<Canteen[]>(() => api.canteens(), [api]);
  const options = (canteens.data ?? []).filter((c) => c.id !== exclude);
  return (
    <Field label={label} error={canteens.error ? 'Could not load canteens' : undefined}>
      {(p) => (
        <Select
          {...p}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={canteens.loading}
        >
          <option value="">{canteens.loading ? 'Loading…' : 'Select a canteen'}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
