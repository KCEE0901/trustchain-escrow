export function normalizeAuditActor(value) {
  return value ?? 'system';
}

export default {
  normalizeAuditActor,
};
