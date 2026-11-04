const AUDIT_EVENTS = [
  ['admin.canteen.services.update', 'Day or Night service settings changed'],
  ['admin.canteen.schedule.update', 'Operating schedule changed'],
  ['admin.menu.item.services.update', 'Menu price or period availability changed'],
  ['admin.canteen.payment_config.update', 'Official payment details changed'],
  ['admin.canteen.payment_mode.update', 'Payment mode changed between DEMO and LIVE'],
  ['admin.canteen.payment_qr.update', 'Official QR configuration changed'],
  ['admin.staff.assigned', 'Staff assigned to a canteen'],
  ['admin.staff.assignments.update', 'Staff canteen assignments or capabilities changed'],
  ['admin.staff.deactivated', 'Staff access removed'],
] as const;

/**
 * Audit events are written to application logs by `writeAudit`.
 * There is no persisted audit table, so this page does not invent a history.
 */
export function ActivityPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Activity logs</h1>
          <p>Sensitive configuration changes are written to the application log as they happen.</p>
        </div>
      </div>
      <section className="section">
        <div className="section-body">
          <p>
            SERVE does not keep a queryable audit history. Each event below is logged with the
            actor, the time, and the affected record. UPI IDs, QR storage keys, passwords, tokens,
            and other secrets are redacted before the line is written. Past lines cannot be listed
            here, and none are filled in.
          </p>
          <p className="muted small">
            A searchable history would need a new audit table. That has not been added.
          </p>
        </div>
        <ul className="plain-list">
          {AUDIT_EVENTS.map(([action, description]) => (
            <li key={action}>
              <span>
                <strong>{action}</strong>
                <span className="muted small activity-detail">{description}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
