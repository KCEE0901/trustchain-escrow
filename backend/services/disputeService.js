/**
 * Dispute resolution service with loading states (#280).
 *
 * Provides skeleton/spinner states while data is fetching,
 * matching existing loading patterns in the app.
 */

class DisputeService {
  constructor(config = {}) {
    this.disputes = new Map();
    this.loadingStates = new Map();
    this.onStateChange = config.onStateChange || (() => {});
  }

  /**
   * Get the loading state for an operation.
   */
  getLoadingState(operationId) {
    return this.loadingStates.get(operationId) || {
      isLoading: false,
      error: null,
      data: null,
    };
  }

  /**
   * Set loading state and notify listeners.
   */
  _setLoading(operationId, isLoading, data = null, error = null) {
    const state = { isLoading, data, error, updatedAt: Date.now() };
    this.loadingStates.set(operationId, state);
    this.onStateChange({ operationId, ...state });
    return state;
  }

  /**
   * Fetch disputes with loading state management.
   * Shows loading while data is in flight, no layout shift on arrival.
   */
  async fetchDisputes(escrowId) {
    const opId = `fetch-disputes-${escrowId}`;
    this._setLoading(opId, true);

    try {
      // Simulated fetch — replace with actual API call
      const disputes = this.disputes.get(escrowId) || [];
      const result = {
        disputes,
        total: disputes.length,
        escrowId,
      };
      this._setLoading(opId, false, result);
      return result;
    } catch (error) {
      const message = error?.message || 'Failed to fetch disputes';
      this._setLoading(opId, false, null, message);
      throw error;
    }
  }

  /**
   * Create a new dispute with loading state.
   */
  async createDispute(escrowId, { reason, evidence = null, requestedOutcome = null }) {
    const opId = `create-dispute-${escrowId}`;
    this._setLoading(opId, true);

    try {
      if (!reason || reason.trim().length === 0) {
        throw new Error('Dispute reason is required');
      }

      const dispute = {
        id: `dispute_${Date.now()}`,
        escrowId,
        reason: reason.trim(),
        evidence,
        requestedOutcome,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        resolution: null,
      };

      const existing = this.disputes.get(escrowId) || [];
      existing.push(dispute);
      this.disputes.set(escrowId, existing);

      this._setLoading(opId, false, dispute);
      return dispute;
    } catch (error) {
      const message = error?.message || 'Failed to create dispute';
      this._setLoading(opId, false, null, message);
      throw error;
    }
  }

  /**
   * Resolve a dispute with loading state.
   */
  async resolveDispute(disputeId, { resolution, resolvedBy }) {
    const opId = `resolve-dispute-${disputeId}`;
    this._setLoading(opId, true);

    try {
      if (!resolution || resolution.trim().length === 0) {
        throw new Error('Resolution is required');
      }

      let found = null;
      for (const [, disputes] of this.disputes) {
        const dispute = disputes.find(d => d.id === disputeId);
        if (dispute) {
          dispute.status = 'resolved';
          dispute.resolution = resolution.trim();
          dispute.resolvedBy = resolvedBy;
          dispute.updatedAt = Date.now();
          found = dispute;
          break;
        }
      }

      if (!found) {
        throw new Error('Dispute not found');
      }

      this._setLoading(opId, false, found);
      return found;
    } catch (error) {
      const message = error?.message || 'Failed to resolve dispute';
      this._setLoading(opId, false, null, message);
      throw error;
    }
  }

  /**
   * Get a dispute by ID.
   */
  getDispute(disputeId) {
    for (const [, disputes] of this.disputes) {
      const dispute = disputes.find(d => d.id === disputeId);
      if (dispute) return dispute;
    }
    return null;
  }
}

module.exports = { DisputeService };
