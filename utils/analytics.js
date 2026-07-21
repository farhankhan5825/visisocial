/**
 * Analytics Utility
 * Comprehensive event tracking, user session analytics, and reporting
 * @version 2.0.0
 */

const logger = require('./logger');
const crypto = require('crypto');

// Storage
const events = [];
const sessions = new Map();
const funnels = new Map();
const MAX_EVENTS = 10000;
const MAX_SESSIONS = 1000;

// Event Categories
const EVENT_CATEGORIES = {
  AUTH: 'auth',
  USER: 'user',
  ANALYSIS: 'analysis',
  EXPORT: 'export',
  API: 'api',
  ERROR: 'error',
  PERFORMANCE: 'performance',
  ENGAGEMENT: 'engagement',
  SYSTEM: 'system'
};

// Funnel Definitions
const FUNNEL_DEFINITIONS = {
  signup: ['page_view_login', 'auth_initiated', 'auth_success', 'profile_loaded', 'analysis_complete'],
  analysis: ['dashboard_view', 'analysis_started', 'analysis_complete', 'insights_viewed'],
  export: ['export_initiated', 'export_generated', 'export_downloaded']
};

const analytics = {
  // Event Categories
  CATEGORIES: EVENT_CATEGORIES,

  /**
   * Track an event
   */
  track(event, data = {}, userId = null) {
    const entry = {
      id: crypto.randomBytes(8).toString('hex'),
      event,
      category: this._categorizeEvent(event),
      data,
      userId,
      timestamp: new Date().toISOString(),
      unix: Date.now()
    };

    events.push(entry);

    // Trim if over limit
    while (events.length > MAX_EVENTS) {
      events.shift();
    }

    // Update funnel progress
    this._updateFunnels(userId, event);

    // Update session if user tracked
    if (userId) {
      this._updateSession(userId, entry);
    }

    logger.debug(`Analytics: ${event}`, { userId, data });
    return entry;
  },

  /**
   * Track page view
   */
  pageView(page, userId = null, metadata = {}) {
    return this.track('page_view', { page, ...metadata }, userId);
  },

  /**
   * Track user action
   */
  action(action, userId, metadata = {}) {
    return this.track(`action_${action}`, metadata, userId);
  },

  /**
   * Track timing/performance
   */
  timing(name, duration, metadata = {}) {
    return this.track('timing', { name, duration, ...metadata });
  },

  /**
   * Track errors
   */
  error(errorType, message, metadata = {}) {
    return this.track('error', { errorType, message, ...metadata });
  },

  /**
   * Start a session
   */
  startSession(userId, metadata = {}) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    const session = {
      id: sessionId,
      userId,
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      events: [],
      metadata,
      pageViews: 0,
      actions: 0,
      duration: 0
    };

    sessions.set(userId, session);

    // Clean old sessions
    if (sessions.size > MAX_SESSIONS) {
      const oldest = [...sessions.entries()]
        .sort((a, b) => new Date(a[1].lastActivity) - new Date(b[1].lastActivity))
        .slice(0, 100);
      oldest.forEach(([key]) => sessions.delete(key));
    }

    this.track('session_start', { sessionId }, userId);
    return session;
  },

  /**
   * End a session
   */
  endSession(userId) {
    const session = sessions.get(userId);
    if (session) {
      session.endedAt = new Date().toISOString();
      session.duration = Date.now() - new Date(session.startedAt).getTime();
      this.track('session_end', {
        sessionId: session.id,
        duration: session.duration,
        pageViews: session.pageViews,
        actions: session.actions
      }, userId);
      sessions.delete(userId);
      return session;
    }
    return null;
  },

  /**
   * Get aggregated weekly stats for dashboard
   * @returns {Object} weekly stats
   */
  getWeeklyStats() {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const recentEvents = events.filter(e => e.unix >= weekAgo);
    const userIds = new Set(recentEvents.filter(e => e.userId).map(e => e.userId));

    const newUsersThisWeek = recentEvents
      .filter(e => e.event === 'page_view_login' || e.event === 'auth_success') // approximation of "new user"
      .map(e => e.userId)
      .filter(Boolean);

    const activeSessions = [...sessions.values()].filter(s => new Date(s.lastActivity).getTime() >= weekAgo);

    return {
      totalEvents: recentEvents.length,
      uniqueUsers: userIds.size,
      newUsers: newUsersThisWeek.length,
      activeSessions: activeSessions.length
    };
  },

  /**
   * Get session
   */
  getSession(userId) {
    return sessions.get(userId);
  },

  /**
   * Get events with filtering
   */
  getEvents(options = {}) {
    let result = [...events];

    if (options.event) {
      result = result.filter(e => e.event === options.event);
    }
    if (options.category) {
      result = result.filter(e => e.category === options.category);
    }
    if (options.userId) {
      result = result.filter(e => e.userId === options.userId);
    }
    if (options.since) {
      const since = new Date(options.since).getTime();
      result = result.filter(e => e.unix >= since);
    }
    if (options.until) {
      const until = new Date(options.until).getTime();
      result = result.filter(e => e.unix <= until);
    }
    if (options.limit) {
      result = result.slice(-options.limit);
    }

    return result;
  },

  /**
   * Get event counts by type
   */
  getEventCounts(since = null) {
    let filtered = events;
    if (since) {
      const sinceTime = new Date(since).getTime();
      filtered = events.filter(e => e.unix >= sinceTime);
    }

    return filtered.reduce((acc, e) => {
      acc[e.event] = (acc[e.event] || 0) + 1;
      return acc;
    }, {});
  },

  /**
   * Get category breakdown
   */
  getCategoryBreakdown(since = null) {
    let filtered = events;
    if (since) {
      const sinceTime = new Date(since).getTime();
      filtered = events.filter(e => e.unix >= sinceTime);
    }

    return filtered.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + 1;
      return acc;
    }, {});
  },

  /**
   * Get user activity stats
   */
  getUserStats(userId) {
    const userEvents = events.filter(e => e.userId === userId);
    const session = sessions.get(userId);

    return {
      totalEvents: userEvents.length,
      eventsByType: userEvents.reduce((acc, e) => {
        acc[e.event] = (acc[e.event] || 0) + 1;
        return acc;
      }, {}),
      firstSeen: userEvents[0]?.timestamp || null,
      lastSeen: userEvents[userEvents.length - 1]?.timestamp || null,
      activeSession: session ? {
        duration: Date.now() - new Date(session.startedAt).getTime(),
        pageViews: session.pageViews,
        actions: session.actions
      } : null
    };
  },

  /**
   * Get funnel analytics
   */
  getFunnelAnalytics(funnelName) {
    const definition = FUNNEL_DEFINITIONS[funnelName];
    if (!definition) return null;

    const userProgress = new Map();

    // Analyze events for funnel steps
    events.forEach(e => {
      if (!e.userId) return;
      const stepIndex = definition.indexOf(e.event);
      if (stepIndex === -1) return;

      const current = userProgress.get(e.userId) || { maxStep: -1, completed: false };
      if (stepIndex > current.maxStep) {
        current.maxStep = stepIndex;
        current.completed = stepIndex === definition.length - 1;
        userProgress.set(e.userId, current);
      }
    });

    // Calculate conversion rates
    const steps = definition.map((step, index) => {
      const count = [...userProgress.values()].filter(p => p.maxStep >= index).length;
      return { step, count };
    });

    const totalUsers = userProgress.size;
    const completedUsers = [...userProgress.values()].filter(p => p.completed).length;

    return {
      name: funnelName,
      steps,
      totalUsers,
      completedUsers,
      conversionRate: totalUsers ? (completedUsers / totalUsers * 100).toFixed(2) : 0,
      dropoff: steps.map((s, i) => {
        if (i === 0) return { step: s.step, dropoff: 0 };
        const prev = steps[i - 1].count;
        return {
          step: s.step,
          dropoff: prev ? ((prev - s.count) / prev * 100).toFixed(2) : 0
        };
      })
    };
  },

  /**
   * Get time-series data
   */
  getTimeSeries(event, interval = 'hour', since = null) {
    let filtered = events.filter(e => e.event === event);
    if (since) {
      const sinceTime = new Date(since).getTime();
      filtered = filtered.filter(e => e.unix >= sinceTime);
    }

    const buckets = new Map();
    const getKey = (date) => {
      const d = new Date(date);
      switch (interval) {
        case 'minute': return d.toISOString().slice(0, 16);
        case 'hour': return d.toISOString().slice(0, 13);
        case 'day': return d.toISOString().slice(0, 10);
        default: return d.toISOString().slice(0, 13);
      }
    };

    filtered.forEach(e => {
      const key = getKey(e.timestamp);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    });

    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([time, count]) => ({ time, count }));
  },

  /**
   * Get comprehensive report
   */
  getReport(since = null) {
    const sinceTime = since ? new Date(since).getTime() : Date.now() - 24 * 60 * 60 * 1000;

    return {
      period: {
        since: new Date(sinceTime).toISOString(),
        until: new Date().toISOString()
      },
      summary: {
        totalEvents: events.filter(e => e.unix >= sinceTime).length,
        uniqueUsers: new Set(events.filter(e => e.unix >= sinceTime && e.userId).map(e => e.userId)).size,
        activeSessions: sessions.size
      },
      eventCounts: this.getEventCounts(sinceTime),
      categoryBreakdown: this.getCategoryBreakdown(sinceTime),
      funnels: Object.keys(FUNNEL_DEFINITIONS).reduce((acc, name) => {
        acc[name] = this.getFunnelAnalytics(name);
        return acc;
      }, {}),
      topEvents: Object.entries(this.getEventCounts(sinceTime))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    };
  },

  /**
   * Clear all analytics data
   */
  clear() {
    events.length = 0;
    sessions.clear();
    funnels.clear();
    logger.info('Analytics data cleared');
  },

  /**
   * Export data
   */
  export() {
    return {
      events: [...events],
      sessions: Object.fromEntries(sessions),
      exportedAt: new Date().toISOString()
    };
  },

  // Internal methods
  _categorizeEvent(event) {
    if (event.startsWith('auth') || event.includes('login') || event.includes('logout')) {
      return EVENT_CATEGORIES.AUTH;
    }
    if (event.startsWith('user') || event.includes('profile')) {
      return EVENT_CATEGORIES.USER;
    }
    if (event.includes('analysis') || event.includes('personality') || event.includes('sentiment')) {
      return EVENT_CATEGORIES.ANALYSIS;
    }
    if (event.includes('export') || event.includes('download')) {
      return EVENT_CATEGORIES.EXPORT;
    }
    if (event.startsWith('api')) {
      return EVENT_CATEGORIES.API;
    }
    if (event.includes('error')) {
      return EVENT_CATEGORIES.ERROR;
    }
    if (event.includes('timing') || event.includes('performance')) {
      return EVENT_CATEGORIES.PERFORMANCE;
    }
    return EVENT_CATEGORIES.SYSTEM;
  },

  _updateSession(userId, event) {
    const session = sessions.get(userId);
    if (!session) return;

    session.lastActivity = event.timestamp;
    session.events.push(event.id);

    if (event.event.includes('page_view')) {
      session.pageViews++;
    } else if (event.event.startsWith('action')) {
      session.actions++;
    }
  },

  _updateFunnels(userId, eventName) {
    if (!userId) return;

    Object.entries(FUNNEL_DEFINITIONS).forEach(([name, steps]) => {
      if (steps.includes(eventName)) {
        const key = `${name}_${userId}`;
        const current = funnels.get(key) || { steps: [] };
        if (!current.steps.includes(eventName)) {
          current.steps.push(eventName);
          funnels.set(key, current);
        }
      }
    });
  }
};

module.exports = analytics;