const toAccrualEntry = (event, index) => ({
  id: event?.id ?? `event-${index}`,
  amount: event?.amount ?? 0,
});

export function buildAccrualEntries(events = []) {
  return events.map((event, index) => toAccrualEntry(event, index));
}

export default function useStreamAccrual(events = []) {
  return buildAccrualEntries(events);
}
