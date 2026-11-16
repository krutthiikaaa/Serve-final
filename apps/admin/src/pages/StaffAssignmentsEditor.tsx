import { useEffect, useState } from 'react';
import type { AdminCanteen, StaffCapability, StaffDetail } from '@serve/contracts';
import { Button, CanteenTypeBadge, FormError, errorMessage, useToast } from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';
import { CAPABILITY_LABEL } from '../lib/warnings';

const CAPABILITIES: StaffCapability[] = ['KITCHEN', 'MENU', 'PAUSE', 'CASHIER'];

/**
 * Permissions of a dedicated staff account on its own canteen. An account
 * works for exactly one canteen; moving it is done with the canteen
 * assignment above, never here.
 */
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
  const canteenId = staff.canteen?.id ?? null;
  const [capabilities, setCapabilities] = useState<StaffCapability[]>(() => current(staff));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => setCapabilities(current(staff)), [staff]);

  if (staff.status !== 'APPROVED' || !canteenId) return null;
  const canteen = canteens.find((row) => row.id === canteenId);

  const toggle = (capability: StaffCapability) =>
    setCapabilities((list) =>
      list.includes(capability)
        ? list.filter((value) => value !== capability)
        : [...list, capability],
    );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateStaffAssignments(staff.id, {
        primaryCanteenId: canteenId,
        assignments: [{ canteenId, capabilities }],
      });
      toast(`Permissions updated for ${staff.name}`);
      onChanged();
    } catch (err) {
      setError(err);
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="assignments-editor">
      <h3 className="subheading">Permissions</h3>
      <p className="muted small">
        For {staff.canteen?.name}
        {canteen ? (
          <>
            {' '}
            <CanteenTypeBadge type={canteen.type} />
          </>
        ) : null}
        . Cashier is never added automatically.
      </p>
      <FormError error={error} />
      <div className="capability-row">
        {CAPABILITIES.map((capability) => (
          <label key={capability} className="checkbox">
            <input
              type="checkbox"
              checked={capabilities.includes(capability)}
              onChange={() => toggle(capability)}
            />
            {CAPABILITY_LABEL[capability]}
          </label>
        ))}
      </div>
      <Button loading={busy} onClick={() => void save()}>
        Save permissions
      </Button>
    </div>
  );
}

function current(staff: StaffDetail): StaffCapability[] {
  return staff.assignments?.find((row) => row.canteenId === staff.canteen?.id)?.capabilities ?? [];
}
