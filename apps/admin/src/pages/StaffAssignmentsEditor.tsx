import { useEffect, useState } from 'react';
import type { AdminCanteen, StaffCapability, StaffDetail } from '@serve/contracts';
import { Button, Field, FormError, Select, Tag, errorMessage, useToast } from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';
import { CAPABILITY_LABEL } from '../lib/warnings';

const CAPABILITIES: StaffCapability[] = ['KITCHEN', 'MENU', 'PAUSE', 'CASHIER'];

interface DraftRow {
  canteenId: string;
  capabilities: StaffCapability[];
}

export function StaffAssignmentsEditor({
  staff,
  canteens,
  onChanged,
}: {
  staff: StaffDetail;
  canteens: AdminCanteen[];
  onChanged: () => void;
}) {
  const api = useAdminApi();
  const toast = useToast();
  const [primaryCanteenId, setPrimaryCanteenId] = useState(staff.canteen?.id ?? '');
  const [rows, setRows] = useState<DraftRow[]>(() => draftsFrom(staff));
  const [addCanteenId, setAddCanteenId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setPrimaryCanteenId(staff.canteen?.id ?? '');
    setRows(draftsFrom(staff));
  }, [staff]);

  const assigned = new Set(rows.map((row) => row.canteenId));
  const addable = canteens.filter((canteen) => canteen.isActive && !assigned.has(canteen.id));
  const nameOf = (id: string) =>
    canteens.find((canteen) => canteen.id === id)?.name ??
    staff.assignments?.find((row) => row.canteenId === id)?.canteen.name ??
    'Canteen';

  const toggleCap = (canteenId: string, capability: StaffCapability) => {
    setRows((current) =>
      current.map((row) => {
        if (row.canteenId !== canteenId) return row;
        const has = row.capabilities.includes(capability);
        return {
          ...row,
          capabilities: has
            ? row.capabilities.filter((value) => value !== capability)
            : [...row.capabilities, capability],
        };
      }),
    );
  };

  const save = async () => {
    if (!primaryCanteenId || !assigned.has(primaryCanteenId)) {
      setError('Choose a primary canteen that is in the assignment list.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateStaffAssignments(staff.id, {
        primaryCanteenId,
        assignments: rows.map((row) => ({
          canteenId: row.canteenId,
          capabilities: row.capabilities,
        })),
      });
      toast(`Assignments updated for ${staff.name}`);
      onChanged();
    } catch (err) {
      setError(err);
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (staff.status === 'DEACTIVATED') return null;

  return (
    <div className="assignments-editor">
      <h3 className="subheading">Canteens and capabilities</h3>
      <p className="muted small">
        Capabilities are granted only when selected. Cashier is never added automatically.
      </p>
      <FormError error={error} />
      {rows.length === 0 ? (
        <p className="muted">No canteen assignments yet.</p>
      ) : (
        <ul className="assignment-list">
          {rows.map((row) => (
            <li key={row.canteenId}>
              <div className="assignment-head">
                <strong>{nameOf(row.canteenId)}</strong>
                {row.canteenId === primaryCanteenId ? <Tag tone="info">Primary</Tag> : null}
                <label className="checkbox">
                  <input
                    type="radio"
                    name={`primary-${staff.id}`}
                    checked={primaryCanteenId === row.canteenId}
                    onChange={() => setPrimaryCanteenId(row.canteenId)}
                  />
                  Make primary
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRows((current) => current.filter((entry) => entry.canteenId !== row.canteenId));
                    if (primaryCanteenId === row.canteenId) {
                      const next = rows.find((entry) => entry.canteenId !== row.canteenId);
                      setPrimaryCanteenId(next?.canteenId ?? '');
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
              <div className="capability-row">
                {CAPABILITIES.map((capability) => (
                  <label key={capability} className="checkbox">
                    <input
                      type="checkbox"
                      checked={row.capabilities.includes(capability)}
                      onChange={() => toggleCap(row.canteenId, capability)}
                    />
                    {CAPABILITY_LABEL[capability]}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="assign-row">
        <Field label="Add another canteen">
          {(p) => (
            <Select {...p} value={addCanteenId} onChange={(e) => setAddCanteenId(e.target.value)}>
              <option value="">Select a canteen</option>
              {addable.map((canteen) => (
                <option key={canteen.id} value={canteen.id}>
                  {canteen.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button
          variant="secondary"
          disabled={!addCanteenId}
          onClick={() => {
            setRows((current) => [...current, { canteenId: addCanteenId, capabilities: [] }]);
            if (!primaryCanteenId) setPrimaryCanteenId(addCanteenId);
            setAddCanteenId('');
          }}
        >
          Add canteen
        </Button>
      </div>

      <Button loading={busy} disabled={rows.length === 0} onClick={() => void save()}>
        Save assignments
      </Button>
    </div>
  );
}

function draftsFrom(staff: StaffDetail): DraftRow[] {
  if (staff.assignments && staff.assignments.length > 0) {
    return staff.assignments.map((row) => ({
      canteenId: row.canteenId,
      capabilities: row.capabilities,
    }));
  }
  if (staff.canteen) return [{ canteenId: staff.canteen.id, capabilities: [] }];
  return [];
}
