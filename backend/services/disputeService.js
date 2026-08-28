function normalizeDisputeId(value) {
  return value == null ? null : String(value);
}

export function createDisputeSummary(dispute) {
  return {
    id: normalizeDisputeId(dispute?.id),
    status: dispute?.status ?? 'pending',
  };
}

export default { createDisputeSummary };
