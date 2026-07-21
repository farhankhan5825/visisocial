/**
 * Metrics Utility
 * Server performance monitoring, counters, gauges, and histograms
 * @version 2.0.0
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Storage
const counters = new Map();
const gauges = new Map();
const timings = new Map();
const histograms = new Map();

// Configuration
const TIMING_SAMPLE_SIZE = 1000;
const HISTOGRAM_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

const metrics = {
  /**
   * Increment a counter
   */
  increment(name, value = 1, tags = {}) {
    const key = this._buildKey(name, tags);
    const current = counters.get(key) || { value: 0, tags, createdAt: Date.now() };
    current.value += value;
    current.lastUpdated = Date.now();
    counters.set(key, current);
    return current.value;
  },

  /**
   * Decrement a counter
   */
  decrement(name, value = 1, tags = {}) {
    return this.increment(name, -value, tags);
  },

  /**
   * Get counter value
   */
  getCounter(name, tags = {}) {
    const key = this._buildKey(name, tags);
    return counters.get(key)?.value || 0;
  },

  /**
   * Set a gauge value
   */
  gauge(name, value, tags = {}) {
    const key = this._buildKey(name, tags);
    gauges.set(key, {
      value,
      tags,
      timestamp: Date.now()
    });
    return value;
  },

  /**
   * Get gauge value
   */
  getGauge(name, tags = {}) {
    const key = this._buildKey(name, tags);
    return gauges.get(key)?.value || null;
  },

  /**
   * Record a timing measurement
   */
  timing(name, duration, tags = {}) {
    const key = this._buildKey(name, tags);
    let data = timings.get(key);

    if (!data) {
      data = {
        samples: [],
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        tags,
        createdAt: Date.now()
      };
      timings.set(key, data);
    }

    // Add sample
    data.samples.push(duration);
    if (data.samples.length > TIMING_SAMPLE_SIZE) {
      data.samples.shift();
    }

    // Update stats
    data.count++;
    data.sum += duration;
    data.min = Math.min(data.min, duration);
    data.max = Math.max(data.max, duration);
    data.lastUpdated = Date.now();

    // Update histogram
    this._updateHistogram(name, duration, tags);

    return duration;
  },

  /**
   * Get timing statistics
   */
  getTiming(name, tags = {}) {
    const key = this._buildKey(name, tags);
    const data = timings.get(key);

    if (!data || data.count === 0) {
      return null;
    }

    const sorted = [...data.samples].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      count: data.count,
      sum: data.sum,
      mean: data.sum / data.count,
      min: data.min,
      max: data.max,
      median: sorted[Math.floor(len / 2)],
      p75: sorted[Math.floor(len * 0.75)],
      p90: sorted[Math.floor(len * 0.90)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)],
      stdDev: this._calculateStdDev(data.samples),
      tags: data.tags
    };
  },

  /**
   * Start a timer (returns a function to stop)
   */
  startTimer(name, tags = {}) {
    const start = process.hrtime.bigint();
    return () => {
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1e6; // Convert to milliseconds
      this.timing(name, duration, tags);
      return duration;
    };
  },

  /**
   * Get histogram data
   */
  getHistogram(name, tags = {}) {
    const key = this._buildKey(name, tags);
    return histograms.get(key) || null;
  },

  /**
   * Record a value in histogram
   */
  histogram(name, value, tags = {}) {
    this._updateHistogram(name, value, tags);
    return value;
  },

  /**
   * Get all metrics
   */
  getAll() {
    return {
      counters: this._mapToObject(counters),
      gauges: this._mapToObject(gauges),
      timings: Object.fromEntries(
        [...timings.entries()].map(([key, data]) => [
          key,
          this.getTiming(key.split(':')[0])
        ])
      ),
      histograms: this._mapToObject(histograms),
      system: this.getSystemMetrics(),
      generatedAt: new Date().toISOString()
    };
  },

  /**
   * Get system metrics
   */
  getSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers,
        heapUsedPercent: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2)
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime(),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    };
  },

  /**
   * Get summary report
   */
  getSummary() {
    const allTimings = [...timings.keys()];
    const timingSummaries = allTimings.map(key => {
      const stats = this.getTiming(key.split(':')[0]);
      return { name: key, ...stats };
    });

    return {
      counters: {
        total: counters.size,
        top: [...counters.entries()]
          .sort((a, b) => b[1].value - a[1].value)
          .slice(0, 10)
          .map(([name, data]) => ({ name, value: data.value }))
      },
      gauges: {
        total: gauges.size,
        current: [...gauges.entries()].map(([name, data]) => ({
          name,
          value: data.value
        }))
      },
      timings: {
        total: timings.size,
        slowest: timingSummaries
          .filter(t => t)
          .sort((a, b) => (b.p95 || 0) - (a.p95 || 0))
          .slice(0, 10)
      },
      system: this.getSystemMetrics()
    };
  },

  /**
   * Reset all metrics
   */
  reset() {
    counters.clear();
    gauges.clear();
    timings.clear();
    histograms.clear();
    logger.info('All metrics reset');
  },

  /**
   * Reset specific metric
   */
  resetMetric(name, tags = {}) {
    const key = this._buildKey(name, tags);
    counters.delete(key);
    gauges.delete(key);
    timings.delete(key);
    histograms.delete(key);
  },

  /**
   * Save metrics to file
   */
  saveToFile(filePath) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        ...this.getAll(),
        savedAt: new Date().toISOString()
      };

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      logger.debug(`Metrics saved to ${filePath}`);
      return true;
    } catch (err) {
      logger.error(`Failed to save metrics: ${err.message}`);
      return false;
    }
  },

  /**
   * Load metrics from file
   */
  loadFromFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Restore counters
      if (data.counters) {
        Object.entries(data.counters).forEach(([key, val]) => {
          counters.set(key, val);
        });
      }

      // Restore gauges
      if (data.gauges) {
        Object.entries(data.gauges).forEach(([key, val]) => {
          gauges.set(key, val);
        });
      }

      logger.info(`Metrics loaded from ${filePath}`);
      return true;
    } catch (err) {
      logger.error(`Failed to load metrics: ${err.message}`);
      return false;
    }
  },

  /**
   * Create middleware for Express request tracking
   */
  createMiddleware() {
    return (req, res, next) => {
      const start = process.hrtime.bigint();

      // Track request
      this.increment('http.requests.total');
      this.increment(`http.requests.method.${req.method.toLowerCase()}`);

      // Track response
      res.on('finish', () => {
        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1e6;

        this.timing('http.request.duration', duration, {
          method: req.method,
          route: req.route?.path || req.path,
          status: res.statusCode
        });

        this.increment(`http.responses.${res.statusCode}`);

        if (res.statusCode >= 400) {
          this.increment('http.errors.total');
          if (res.statusCode >= 500) {
            this.increment('http.errors.server');
          } else {
            this.increment('http.errors.client');
          }
        }
      });

      next();
    };
  },

  // Internal helpers
  _buildKey(name, tags = {}) {
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return tagStr ? `${name}:${tagStr}` : name;
  },

  _mapToObject(map) {
    return Object.fromEntries(map);
  },

  _calculateStdDev(samples) {
    if (samples.length < 2) return 0;
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const squaredDiffs = samples.map(s => Math.pow(s - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / samples.length;
    return Math.sqrt(variance);
  },

  _updateHistogram(name, value, tags = {}) {
    const key = this._buildKey(name, tags);
    let data = histograms.get(key);

    if (!data) {
      data = {
        buckets: HISTOGRAM_BUCKETS.reduce((acc, b) => {
          acc[b] = 0;
          return acc;
        }, {}),
        count: 0,
        sum: 0,
        tags
      };
      histograms.set(key, data);
    }

    data.count++;
    data.sum += value;

    // Increment appropriate bucket
    for (const bucket of HISTOGRAM_BUCKETS) {
      if (value <= bucket) {
        data.buckets[bucket]++;
        break;
      }
    }
  }
};

module.exports = metrics;