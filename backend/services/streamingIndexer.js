/**
 * Streaming indexer service with keyboard navigation support (#279).
 *
 * Provides an interactive indexer monitor with full keyboard operability:
 * - Enter/Space: activate/toggle items
 * - Escape: close/cancel
 * - Tab: navigate between elements
 * - Arrow keys: navigate within lists
 */

class StreamingIndexer {
  constructor(config = {}) {
    this.streams = new Map();
    this.cursor = null;
    this.isRunning = false;
    this.onUpdate = config.onUpdate || (() => {});
    this.onError = config.onError || (() => {});
    this.focusedIndex = -1;
    this.items = [];
  }

  /**
   * Start indexing a Stellar stream.
   */
  async startStream(streamId, options = {}) {
    if (this.streams.has(streamId)) {
      return { error: 'Stream already active' };
    }

    const stream = {
      id: streamId,
      cursor: options.cursor || 'now',
      status: 'active',
      startedAt: Date.now(),
      lastEvent: null,
      eventCount: 0,
    };

    this.streams.set(streamId, stream);
    this.isRunning = true;
    this.items = Array.from(this.streams.values());
    this.onUpdate({ type: 'stream_started', stream });

    return { success: true, stream };
  }

  /**
   * Stop a specific stream.
   */
  stopStream(streamId) {
    const stream = this.streams.get(streamId);
    if (!stream) {
      return { error: 'Stream not found' };
    }

    stream.status = 'stopped';
    this.streams.delete(streamId);
    this.items = Array.from(this.streams.values());
    this.onUpdate({ type: 'stream_stopped', stream });

    if (this.streams.size === 0) {
      this.isRunning = false;
    }

    return { success: true };
  }

  /**
   * Process an incoming event from a stream.
   */
  processEvent(streamId, event) {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    stream.lastEvent = event;
    stream.eventCount += 1;
    stream.cursor = event.paging_token || stream.cursor;

    this.onUpdate({ type: 'event', streamId, event });
  }

  /**
   * Handle keyboard events for interactive elements (#279).
   */
  handleKeyDown(event) {
    const { key } = event;

    switch (key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.activateItem(this.focusedIndex);
        break;

      case 'Escape':
        event.preventDefault();
        this.clearFocus();
        break;

      case 'ArrowDown':
        event.preventDefault();
        this.moveFocus(1);
        break;

      case 'ArrowUp':
        event.preventDefault();
        this.moveFocus(-1);
        break;

      case 'Tab':
        // Allow default tab behavior for moving between elements
        break;

      case 'Home':
        event.preventDefault();
        this.setFocus(0);
        break;

      case 'End':
        event.preventDefault();
        this.setFocus(this.items.length - 1);
        break;

      default:
        break;
    }
  }

  /**
   * Move focus by a delta amount.
   */
  moveFocus(delta) {
    const newIndex = Math.max(0, Math.min(this.items.length - 1, this.focusedIndex + delta));
    this.setFocus(newIndex);
  }

  /**
   * Set focus to a specific index.
   */
  setFocus(index) {
    if (index >= 0 && index < this.items.length) {
      this.focusedIndex = index;
      this.onUpdate({ type: 'focus_changed', index, item: this.items[index] });
    }
  }

  /**
   * Clear the current focus.
   */
  clearFocus() {
    this.focusedIndex = -1;
    this.onUpdate({ type: 'focus_cleared' });
  }

  /**
   * Activate the item at the given index.
   */
  activateItem(index) {
    if (index >= 0 && index < this.items.length) {
      const item = this.items[index];
      this.onUpdate({ type: 'item_activated', index, item });
    }
  }

  /**
   * Get all active streams.
   */
  getStreams() {
    return Array.from(this.streams.values());
  }

  /**
   * Get the current status.
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      streamCount: this.streams.size,
      focusedIndex: this.focusedIndex,
    };
  }
}

module.exports = { StreamingIndexer };
