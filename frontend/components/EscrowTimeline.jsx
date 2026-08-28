/**
 * Timeline renderer for escrow progress states.
 *
 * @param {{ events?: Array<{ id?: string|number, label?: string, timestamp?: string }> }} props
 * @returns {JSX.Element}
 */
export default function EscrowTimeline({ events = [] }) {
  return (
    <div className="escrow-timeline">
      {events.map((event, index) => (
        <div key={event.id ?? index} className="escrow-timeline__event">
          <div className="escrow-timeline__label">{event.label ?? 'Escrow event'}</div>
          <div className="escrow-timeline__timestamp">{event.timestamp ?? 'Pending'}</div>
        </div>
      ))}
    </div>
  );
}
