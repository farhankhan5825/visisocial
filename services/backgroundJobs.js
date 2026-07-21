/**
 * Background Jobs Service
 * Job scheduling, queuing, and execution
 * @version 2.0.0
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const taskStatus = require('../utils/taskStatus');
const cache = require('../utils/cache');
const config = require('../config/appConfig');

// Job storage
const jobs = new Map();
const scheduledJobs = new Map();
const jobQueue = [];
const runningJobs = new Set();

// Configuration
const MAX_CONCURRENT_JOBS = 5;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY = 5000;

// Event emitter
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

// Job states
const JOB_STATES = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'retrying'
};

/**
 * Background Jobs Manager
 */
const backgroundJobs = {
  STATES: JOB_STATES,

  /**
   * Register a job handler
   */
  register(name, handler, options = {}) {
    const jobDef = {
      name,
      handler,
      options: {
        timeout: options.timeout || 60000,
        retries: options.retries ?? DEFAULT_RETRY_ATTEMPTS,
        retryDelay: options.retryDelay || DEFAULT_RETRY_DELAY,
        unique: options.unique || false,
        priority: options.priority || 0
      }
    };

    jobs.set(name, jobDef);
    logger.debug(`Registered job: ${name}`);
    return jobDef;
  },

  /**
   * Schedule a job to run
   */
  async schedule(name, data = {}, options = {}) {
    const jobDef = jobs.get(name);
    if (!jobDef) {
      throw new Error(`Job not registered: ${name}`);
    }

    // Check uniqueness
    if (jobDef.options.unique) {
      const existing = jobQueue.find(j => j.name === name && j.state === JOB_STATES.PENDING);
      if (existing) {
        logger.debug(`Skipping duplicate job: ${name}`);
        return existing;
      }
    }

    const jobId = crypto.randomBytes(8).toString('hex');
    const job = {
      id: jobId,
      name,
      data,
      state: JOB_STATES.PENDING,
      attempts: 0,
      maxAttempts: options.retries ?? jobDef.options.retries,
      priority: options.priority ?? jobDef.options.priority,
      createdAt: Date.now(),
      scheduledFor: options.delay ? Date.now() + options.delay : Date.now(),
      timeout: options.timeout || jobDef.options.timeout,
      result: null,
      error: null,
      logs: []
    };

    jobQueue.push(job);
    jobQueue.sort((a, b) => b.priority - a.priority || a.scheduledFor - b.scheduledFor);

    logger.info(`Job scheduled: ${name}`, { jobId });
    metrics.increment('jobs.scheduled');
    emitter.emit('job:scheduled', job);

    // Process queue
    this._processQueue();

    return job;
  },

  /**
   * Run a job immediately
   */
  async run(name, data = {}) {
    const job = await this.schedule(name, data, { priority: 100 });
    return this._waitForJob(job.id);
  },

  /**
   * Schedule a recurring job
   */
  scheduleRecurring(name, interval, data = {}) {
    const jobDef = jobs.get(name);
    if (!jobDef) {
      throw new Error(`Job not registered: ${name}`);
    }

    const scheduleId = `${name}_recurring`;

    // Clear existing schedule
    if (scheduledJobs.has(scheduleId)) {
      clearInterval(scheduledJobs.get(scheduleId).intervalId);
    }

    const schedule = {
      id: scheduleId,
      name,
      interval,
      data,
      lastRun: null,
      nextRun: Date.now() + interval,
      runCount: 0,
      intervalId: setInterval(async () => {
        try {
          schedule.lastRun = Date.now();
          schedule.nextRun = Date.now() + interval;
          schedule.runCount++;

          await this.schedule(name, data);
        } catch (err) {
          logger.error(`Recurring job error: ${name}`, { error: err.message });
        }
      }, interval)
    };

    scheduledJobs.set(scheduleId, schedule);
    logger.info(`Recurring job scheduled: ${name}`, { interval });

    // Run immediately if requested
    this.schedule(name, data);

    return schedule;
  },

  /**
   * Cancel a scheduled recurring job
   */
  cancelRecurring(name) {
    const scheduleId = `${name}_recurring`;
    const schedule = scheduledJobs.get(scheduleId);

    if (schedule) {
      clearInterval(schedule.intervalId);
      scheduledJobs.delete(scheduleId);
      logger.info(`Recurring job cancelled: ${name}`);
      return true;
    }

    return false;
  },

  /**
   * Get job by ID
   */
  get(jobId) {
    return jobQueue.find(j => j.id === jobId) || null;
  },

  /**
   * Get all jobs
   */
  list(options = {}) {
    let result = [...jobQueue];

    if (options.state) {
      result = result.filter(j => j.state === options.state);
    }
    if (options.name) {
      result = result.filter(j => j.name === options.name);
    }
    if (options.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  },

  /**
   * Get scheduled recurring jobs
   */
  listScheduled() {
    return [...scheduledJobs.values()].map(s => ({
      id: s.id,
      name: s.name,
      interval: s.interval,
      lastRun: s.lastRun,
      nextRun: s.nextRun,
      runCount: s.runCount
    }));
  },

  /**
   * Cancel a job
   */
  cancel(jobId) {
    const job = jobQueue.find(j => j.id === jobId);
    if (!job) return null;

    if (job.state === JOB_STATES.RUNNING) {
      logger.warn(`Cannot cancel running job: ${jobId}`);
      return null;
    }

    job.state = JOB_STATES.CANCELLED;
    emitter.emit('job:cancelled', job);
    metrics.increment('jobs.cancelled');

    return job;
  },

  /**
   * Subscribe to job events
   */
  on(event, handler) {
    emitter.on(event, handler);
    return () => emitter.off(event, handler);
  },

  /**
   * Get statistics
   */
  getStats() {
    const states = Object.values(JOB_STATES);
    const byCounts = states.reduce((acc, state) => {
      acc[state] = jobQueue.filter(j => j.state === state).length;
      return acc;
    }, {});

    return {
      total: jobQueue.length,
      byState: byCounts,
      running: runningJobs.size,
      registered: jobs.size,
      scheduled: scheduledJobs.size,
      queueLength: jobQueue.filter(j => j.state === JOB_STATES.PENDING).length
    };
  },

  /**
   * Clear completed/failed jobs
   */
  cleanup(maxAge = 60 * 60 * 1000) {
    const now = Date.now();
    const toRemove = [];

    jobQueue.forEach((job, index) => {
      const isFinished = [JOB_STATES.COMPLETED, JOB_STATES.FAILED, JOB_STATES.CANCELLED].includes(job.state);
      const isOld = (job.completedAt || job.createdAt) < now - maxAge;

      if (isFinished && isOld) {
        toRemove.push(index);
      }
    });

    // Remove in reverse order to maintain indices
    toRemove.reverse().forEach(i => jobQueue.splice(i, 1));

    return toRemove.length;
  },

  // Internal methods
  async _processQueue() {
    // Don't exceed max concurrent
    if (runningJobs.size >= MAX_CONCURRENT_JOBS) return;

    // Find next job to run
    const now = Date.now();
    const pendingJob = jobQueue.find(j =>
      j.state === JOB_STATES.PENDING &&
      j.scheduledFor <= now
    );

    if (!pendingJob) return;

    // Execute job
    await this._executeJob(pendingJob);

    // Process next
    setImmediate(() => this._processQueue());
  },

  async _executeJob(job) {
    const jobDef = jobs.get(job.name);
    if (!jobDef) {
      job.state = JOB_STATES.FAILED;
      job.error = 'Job handler not found';
      return;
    }

    job.state = JOB_STATES.RUNNING;
    job.startedAt = Date.now();
    job.attempts++;
    runningJobs.add(job.id);

    logger.info(`Job started: ${job.name}`, { jobId: job.id, attempt: job.attempts });
    metrics.increment('jobs.started');
    emitter.emit('job:started', job);

    // Create timeout
    const timeoutId = setTimeout(() => {
      if (job.state === JOB_STATES.RUNNING) {
        job.state = JOB_STATES.FAILED;
        job.error = 'Job timed out';
        runningJobs.delete(job.id);
        emitter.emit('job:timeout', job);
      }
    }, job.timeout);

    try {
      // Create job context
      const context = {
        jobId: job.id,
        attempt: job.attempts,
        log: (message) => {
          job.logs.push({ time: Date.now(), message });
          logger.debug(`[Job ${job.id}] ${message}`);
        }
      };

      // Execute handler
      const result = await jobDef.handler(job.data, context);

      clearTimeout(timeoutId);

      job.state = JOB_STATES.COMPLETED;
      job.result = result;
      job.completedAt = Date.now();
      job.duration = job.completedAt - job.startedAt;

      logger.info(`Job completed: ${job.name}`, {
        jobId: job.id,
        duration: job.duration
      });
      metrics.increment('jobs.completed');
      metrics.timing('jobs.duration', job.duration, { name: job.name });
      emitter.emit('job:completed', job);

    } catch (error) {
      clearTimeout(timeoutId);

      job.error = {
        message: error.message,
        stack: error.stack
      };

      // Retry if attempts remaining
      if (job.attempts < job.maxAttempts) {
        job.state = JOB_STATES.RETRYING;
        job.scheduledFor = Date.now() + (jobDef.options.retryDelay * job.attempts);

        logger.warn(`Job failed, retrying: ${job.name}`, {
          jobId: job.id,
          attempt: job.attempts,
          error: error.message
        });

        // Reset to pending after delay
        setTimeout(() => {
          if (job.state === JOB_STATES.RETRYING) {
            job.state = JOB_STATES.PENDING;
            this._processQueue();
          }
        }, jobDef.options.retryDelay * job.attempts);

      } else {
        job.state = JOB_STATES.FAILED;
        job.completedAt = Date.now();

        logger.error(`Job failed: ${job.name}`, {
          jobId: job.id,
          error: error.message
        });
        metrics.increment('jobs.failed');
        emitter.emit('job:failed', job);
      }

    } finally {
      runningJobs.delete(job.id);
    }
  },

  _waitForJob(jobId, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Job wait timeout'));
      }, timeout);

      const checkJob = () => {
        const job = this.get(jobId);
        if (!job) {
          clearTimeout(timeoutId);
          reject(new Error('Job not found'));
          return;
        }

        if (job.state === JOB_STATES.COMPLETED) {
          clearTimeout(timeoutId);
          resolve(job.result);
        } else if (job.state === JOB_STATES.FAILED) {
          clearTimeout(timeoutId);
          reject(new Error(job.error?.message || 'Job failed'));
        } else {
          setTimeout(checkJob, 100);
        }
      };

      checkJob();
    });
  }
};

/**
 * Initialize background jobs
 */
function initializeBackgroundJobs() {
  logger.info('Initializing background jobs...');

  // Register built-in jobs
  backgroundJobs.register('cleanup_tokens', async (data, ctx) => {
    const UserToken = require('../models/UserToken');
    ctx.log('Cleaning up expired tokens...');

    const result = await UserToken.deleteMany({
      $or: [
        { expiresAt: { $lt: new Date() } },
        { isValid: false, revokedAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }
      ]
    });

    ctx.log(`Deleted ${result.deletedCount} tokens`);
    return { deleted: result.deletedCount };
  }, { timeout: 30000 });

  backgroundJobs.register('cleanup_tasks', async (data, ctx) => {
    ctx.log('Cleaning up old tasks...');
    const cleaned = taskStatus.cleanup();
    ctx.log(`Cleaned ${cleaned} tasks`);
    return { cleaned };
  });

  backgroundJobs.register('cleanup_cache', async (data, ctx) => {
    ctx.log('Cleaning up cache...');
    if (cache.cleanup) {
      await cache.cleanup();
    }
    ctx.log('Cache cleanup complete');
    return { success: true };
  });

  backgroundJobs.register('save_metrics', async (data, ctx) => {
    const path = require('path');
    const metricsPath = path.join(process.cwd(), 'data', 'metrics.json');
    ctx.log(`Saving metrics to ${metricsPath}`);
    metrics.saveToFile(metricsPath);
    return { saved: true };
  });

  backgroundJobs.register('update_user_stats', async (data, ctx) => {
    const User = require('../models/User');
    const userId = data.userId;

    ctx.log(`Updating stats for user: ${userId}`);

    const user = await User.findOne({ id: userId });
    if (!user) {
      throw new Error('User not found');
    }

    // Update engagement score
    const engagementScore = Math.min(100, Math.round(
      ((user.feedData?.length || 0) / 10) * 10 +
      ((user.likes?.length || 0) / 5) * 5 +
      (user.albumsData?.length || 0) * 5
    ));

    user.engagementScore = engagementScore;
    user.lastUpdated = new Date();
    await user.save();

    ctx.log(`Updated engagement score: ${engagementScore}`);
    return { userId, engagementScore };
  }, { timeout: 30000 });

  // Schedule recurring jobs based on config
  if (config.jobs) {
    // Token cleanup - daily
    backgroundJobs.scheduleRecurring('cleanup_tokens', 24 * 60 * 60 * 1000);


    // Metrics save - every 15 minutes
    backgroundJobs.scheduleRecurring('save_metrics', 15 * 60 * 1000);
  }

  logger.info('Background jobs initialized', {
    registered: backgroundJobs.getStats().registered
  });
}

module.exports = { backgroundJobs, initializeBackgroundJobs };