/**
 * @param {{ events?: Array<{ id?: string|number, label?: string, status?: string }> }} props
 */
export default function EscrowTimeline({ events = [] }) {
  const getStatusMessage = (status) => {
    switch (status) {
      case 'complete':
        return 'Completed successfully';
      case 'disputed':
        return 'Needs dispute resolution';
      default:
        return 'Awaiting next action';
    }
  };

  return (
    <div className="escrow-timeline">
      {events.map((event, index) => (
        <div key={event.id ?? index} className="escrow-timeline__item">
          <div className="escrow-timeline__label">{event.label ?? 'Escrow event'}</div>
          <div className="escrow-timeline__meta">{getStatusMessage(event.status)}</div>
        </div>
      ))}
    </div>
  );
}
