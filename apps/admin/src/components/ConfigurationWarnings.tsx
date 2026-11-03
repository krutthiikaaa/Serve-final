import type { AdminConfigurationWarning } from '@serve/contracts';
import { IconAlert } from '@serve/web-shared';
import { warningText } from '../lib/warnings';

export function ConfigurationWarnings({
  warnings,
}: {
  warnings: AdminConfigurationWarning[] | undefined;
}) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="warning-stack" role="status">
      {warnings.map((warning, index) => (
        <div key={`${warning.code}-${warning.period ?? 'canteen'}-${index}`} className="notice">
          <IconAlert width={18} height={18} />
          <span>{warningText(warning)}</span>
        </div>
      ))}
    </div>
  );
}
