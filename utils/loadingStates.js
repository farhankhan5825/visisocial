/**
 * Loading States Utility
 * Manage UI loading states with real-time updates
 * @version 2.0.0
 */

const EventEmitter = require('events');

// Storage
const states = new Map();
const emitter = new EventEmitter();
emitter.setMaxListeners(100);

// Default TTL for states (10 minutes)
const DEFAULT_TTL = 10 * 60 * 1000;

// Status types
const STATUS_TYPES = {
  INITIALIZING: 'initializing',
  AUTHENTICATING: 'authenticating',
  PROCESSING: 'processing',
  FETCHING_DATA: 'fetching_data',
  ANALYZING: 'analyzing',
  UPDATING_PROFILE: 'updating_profile',
  FINALIZING: 'finalizing',
  COMPLETE: 'complete',
  ERROR: 'error'
};

// Status messages
const STATUS_MESSAGES = {
  [STATUS_TYPES.INITIALIZING]: 'Initializing...',
  [STATUS_TYPES.AUTHENTICATING]: 'Authenticating with Facebook...',
  [STATUS_TYPES.PROCESSING]: 'Processing authentication...',
  [STATUS_TYPES.FETCHING_DATA]: 'Fetching your data from Facebook...',
  [STATUS_TYPES.ANALYZING]: 'Analyzing your profile data...',
  [STATUS_TYPES.UPDATING_PROFILE]: 'Updating your profile...',
  [STATUS_TYPES.FINALIZING]: 'Finalizing...',
  [STATUS_TYPES.COMPLETE]: 'Complete!',
  [STATUS_TYPES.ERROR]: 'An error occurred'
};

// Progress mapping for statuses
const STATUS_PROGRESS = {
  [STATUS_TYPES.INITIALIZING]: 5,
  [STATUS_TYPES.AUTHENTICATING]: 15,
  [STATUS_TYPES.PROCESSING]: 30,
  [STATUS_TYPES.FETCHING_DATA]: 50,
  [STATUS_TYPES.ANALYZING]: 70,
  [STATUS_TYPES.UPDATING_PROFILE]: 85,
  [STATUS_TYPES.FINALIZING]: 95,
  [STATUS_TYPES.COMPLETE]: 100,
  [STATUS_TYPES.ERROR]: 0
};

const loadingStates = {
  // Status types enum
  STATUS: STATUS_TYPES,

  /**
   * Set a loading state
   */
  set(id, state) {
    if (!id) return null;

    const existing = states.get(id);
    const newState = {
      id,
      status: state.status || STATUS_TYPES.INITIALIZING,
      progress: state.progress ?? STATUS_PROGRESS[state.status] ?? 0,
      message: state.message || STATUS_MESSAGES[state.status] || '',
      details: state.details || null,
      error: state.error || null,
      startedAt: existing?.startedAt || Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + (state.ttl || DEFAULT_TTL)
    };

    states.set(id, newState);
    emitter.emit('update', newState);
    emitter.emit(`update:${id}`, newState);

    // Schedule cleanup
    this._scheduleCleanup(id, newState.expiresAt);

    return newState;
  },

  /**
   * Get a loading state
   */
  get(id) {
    if (!id) return null;

    const state = states.get(id);
    if (!state) return null;

    // Check expiry
    if (state.expiresAt < Date.now()) {
      states.delete(id);
      return null;
    }

    return state;
  },

  /**
   * Update progress
   */
  updateProgress(id, progress, message = null) {
    const state = states.get(id);
    if (!state) return null;

    state.progress = Math.max(0, Math.min(100, progress));
    if (message) state.message = message;
    state.updatedAt = Date.now();

    emitter.emit('progress', state);
    emitter.emit(`update:${id}`, state);

    return state;
  },

  /**
   * Set status (with automatic progress)
   */
  setStatus(id, status, message = null) {
    const state = states.get(id) || { id };

    return this.set(id, {
      ...state,
      status,
      progress: STATUS_PROGRESS[status] || state.progress,
      message: message || STATUS_MESSAGES[status] || state.message
    });
  },

  /**
   * Mark as complete
   */
  complete(id, message = null) {
    return this.setStatus(id, STATUS_TYPES.COMPLETE, message || 'Complete!');
  },

  /**
   * Mark as error
   */
  error(id, error, message = null) {
    const errorDetails = error instanceof Error
      ? { name: error.name, message: error.message }
      : { message: String(error) };

    return this.set(id, {
      status: STATUS_TYPES.ERROR,
      progress: 0,
      message: message || errorDetails.message || 'An error occurred',
      error: errorDetails
    });
  },

  /**
   * Remove a state
   */
  remove(id) {
    const existed = states.has(id);
    states.delete(id);
    if (existed) {
      emitter.emit('removed', id);
    }
    return existed;
  },

  /**
   * Check if state exists
   */
  has(id) {
    return states.has(id) && states.get(id).expiresAt > Date.now();
  },

  /**
   * Subscribe to updates
   */
  subscribe(id, callback) {
    const handler = (state) => callback(state);
    emitter.on(`update:${id}`, handler);

    // Return unsubscribe function
    return () => emitter.off(`update:${id}`, handler);
  },

  /**
   * Subscribe to all updates
   */
  onUpdate(callback) {
    emitter.on('update', callback);
    return () => emitter.off('update', callback);
  },

  /**
   * Get all active states
   */
  getAll() {
    const now = Date.now();
    const result = {};

    for (const [id, state] of states.entries()) {
      if (state.expiresAt > now) {
        result[id] = state;
      }
    }

    return result;
  },

  /**
   * Get states by status
   */
  getByStatus(status) {
    const now = Date.now();
    return [...states.values()].filter(
      s => s.status === status && s.expiresAt > now
    );
  },

  /**
   * Clear all states
   */
  clear() {
    const count = states.size;
    states.clear();
    emitter.emit('cleared');
    return count;
  },

  /**
   * Cleanup expired states
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, state] of states.entries()) {
      if (state.expiresAt < now) {
        states.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  },

  /**
   * Create a progress tracker
   */
  createTracker(id, steps = []) {
    let currentStep = -1;
    const totalSteps = steps.length;

    this.set(id, {
      status: STATUS_TYPES.INITIALIZING,
      progress: 0,
      message: 'Starting...'
    });

    return {
      next: (customMessage = null) => {
        currentStep++;
        if (currentStep < totalSteps) {
          const stepInfo = steps[currentStep];
          const progress = Math.round(((currentStep + 1) / totalSteps) * 100);
          this.set(id, {
            status: stepInfo.status || STATUS_TYPES.PROCESSING,
            progress,
            message: customMessage || stepInfo.message || `Step ${currentStep + 1} of ${totalSteps}`
          });
        }
        return currentStep < totalSteps;
      },
      complete: (message = null) => {
        this.complete(id, message);
      },
      error: (error, message = null) => {
        this.error(id, error, message);
      },
      getState: () => this.get(id)
    };
  },

  /**
   * Get statistics
   */
  getStats() {
    const all = [...states.values()];
    const now = Date.now();
    const active = all.filter(s => s.expiresAt > now);

    return {
      total: all.length,
      active: active.length,
      expired: all.length - active.length,
      byStatus: active.reduce((acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      }, {})
    };
  },

  // Internal helpers
  _scheduleCleanup(id, expiresAt) {
    const delay = expiresAt - Date.now();
    if (delay > 0 && delay < DEFAULT_TTL * 2) {
      setTimeout(() => {
        const state = states.get(id);
        if (state && state.expiresAt <= Date.now()) {
          states.delete(id);
          emitter.emit('expired', id);
        }
      }, delay + 100);
    }
  }
};

// Periodic cleanup
setInterval(() => {
  loadingStates.cleanup();
}, 60000);

module.exports = loadingStates;