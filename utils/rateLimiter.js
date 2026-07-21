/**
 * Rate Limiter Utility
 * Flexible rate limiting with multiple strategies
 * @version 2.0.0
 */

const logger = require('./logger');

// Storage
const stores = new Map();

/**
 * Create a rate limiter middleware
 */
function rateLimiter(options = {}) {
  const {
    windowMs = 60 * 1000, // 1 minute default
    max = 100, // 100 requests per window
    message = 'Too many requests, please try again later.',
    statusCode = 429,
    headers = true,
    keyGenerator = (req) => req.ip || req.connection.remoteAddress || 'unknown',
    skip = () => false,
    handler = null,
    store = null,
    standardHeaders = true,
    legacyHeaders = false
  } = options;

  // Use provided store or create memory store
  const limiterStore = store || createMemoryStore();
  const storeId = Symbol('limiter');
  stores.set(storeId, limiterStore);

  return async function rateLimiterMiddleware(req, res, next) {
    // Check if should skip
    if (skip(req, res)) {
      return next();
    }

    const key = keyGenerator(req, res);

    try {
      const result = await limiterStore.increment(key, { windowMs, max });

      // Set headers
      if (headers) {
        if (standardHeaders) {
          res.setHeader('RateLimit-Limit', max);
          res.setHeader('RateLimit-Remaining', Math.max(0, max - result.totalHits));
          res.setHeader('RateLimit-Reset', Math.ceil(result.resetTime.getTime() / 1000));
        }
        if (legacyHeaders) {
          res.setHeader('X-RateLimit-Limit', max);
          res.setHeader('X-RateLimit-Remaining', Math.max(0, max - result.totalHits));
          res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime.getTime() / 1000));
        }
      }

      // Check if limit exceeded
      if (result.totalHits > max) {
        logger.warn('Rate limit exceeded', { key, hits: result.totalHits, max });

        res.setHeader('Retry-After', Math.ceil((result.resetTime.getTime() - Date.now()) / 1000));

        if (handler) {
          return handler(req, res, next, { ...options, ...result });
        }

        return res.status(statusCode).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message,
          retryAfter: Math.ceil((result.resetTime.getTime() - Date.now()) / 1000)
        });
      }

      next();
    } catch (err) {
      logger.error('Rate limiter error', { error: err.message });
      // On error, allow request through
      next();
    }
  };
}

/**
 * Create an in-memory store
 */
function createMemoryStore() {
  const hits = new Map();

  // Cleanup interval
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of hits.entries()) {
      if (data.resetTime.getTime() < now) {
        hits.delete(key);
      }
    }
  }, 60000);

  return {
    async increment(key, options) {
      const now = Date.now();
      let data = hits.get(key);

      if (!data || data.resetTime.getTime() < now) {
        data = {
          totalHits: 0,
          resetTime: new Date(now + options.windowMs)
        };
      }

      data.totalHits++;
      hits.set(key, data);

      return {
        totalHits: data.totalHits,
        resetTime: data.resetTime,
        remainingHits: Math.max(0, options.max - data.totalHits)
      };
    },

    async decrement(key) {
      const data = hits.get(key);
      if (data && data.totalHits > 0) {
        data.totalHits--;
      }
    },

    async resetKey(key) {
      hits.delete(key);
    },

    async resetAll() {
      hits.clear();
    },

    async getStats() {
      return {
        keys: hits.size,
        totalHits: [...hits.values()].reduce((sum, d) => sum + d.totalHits, 0)
      };
    }
  };
}

/**
 * Create a sliding window rate limiter
 */
function slidingWindowLimiter(options = {}) {
  const {
    windowMs = 60 * 1000,
    max = 100,
    keyGenerator = (req) => req.ip,
    ...rest
  } = options;

  const windows = new Map();

  return rateLimiter({
    ...rest,
    windowMs,
    max,
    keyGenerator,
    store: {
      async increment(key, opts) {
        const now = Date.now();
        const windowStart = now - opts.windowMs;

        let data = windows.get(key) || { timestamps: [] };

        // Remove old timestamps
        data.timestamps = data.timestamps.filter(t => t > windowStart);

        // Add new timestamp
        data.timestamps.push(now);
        windows.set(key, data);

        return {
          totalHits: data.timestamps.length,
          resetTime: new Date(now + opts.windowMs),
          remainingHits: Math.max(0, opts.max - data.timestamps.length)
        };
      },

      async decrement(key) {
        const data = windows.get(key);
        if (data && data.timestamps.length > 0) {
          data.timestamps.pop();
        }
      },

      async resetKey(key) {
        windows.delete(key);
      },

      async resetAll() {
        windows.clear();
      }
    }
  });
}

/**
 * Create a token bucket rate limiter
 */
function tokenBucketLimiter(options = {}) {
  const {
    capacity = 100,          // Max tokens
    refillRate = 10,         // Tokens per second
    keyGenerator = (req) => req.ip,
    ...rest
  } = options;

  const buckets = new Map();

  return rateLimiter({
    ...rest,
    max: capacity,
    keyGenerator,
    store: {
      async increment(key, opts) {
        const now = Date.now();
        let bucket = buckets.get(key);

        if (!bucket) {
          bucket = {
            tokens: capacity,
            lastRefill: now
          };
        }

        // Refill tokens
        const elapsed = (now - bucket.lastRefill) / 1000;
        bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRate);
        bucket.lastRefill = now;

        // Consume token
        bucket.tokens--;
        buckets.set(key, bucket);

        const hasTokens = bucket.tokens >= 0;

        return {
          totalHits: hasTokens ? 1 : capacity + 1,
          resetTime: new Date(now + (hasTokens ? 0 : Math.ceil(-bucket.tokens / refillRate) * 1000)),
          remainingHits: Math.max(0, Math.floor(bucket.tokens))
        };
      },

      async decrement(key) {
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.tokens = Math.min(capacity, bucket.tokens + 1);
        }
      },

      async resetKey(key) {
        buckets.delete(key);
      },

      async resetAll() {
        buckets.clear();
      }
    }
  });
}

/**
 * Create tiered rate limiter
 */
function tieredLimiter(tiers = {}) {
  const limiters = {};

  for (const [name, config] of Object.entries(tiers)) {
    limiters[name] = rateLimiter(config);
  }

  return function tieredMiddleware(tierName) {
    return (req, res, next) => {
      const limiter = limiters[tierName] || limiters.default;
      if (limiter) {
        return limiter(req, res, next);
      }
      next();
    };
  };
}

/**
 * IP-based rate limiter with whitelist
 */
function ipRateLimiter(options = {}) {
  const {
    whitelist = [],
    blacklist = [],
    ...rest
  } = options;

  const whitelistSet = new Set(whitelist);
  const blacklistSet = new Set(blacklist);

  return rateLimiter({
    ...rest,
    skip: (req) => {
      const ip = req.ip || req.connection.remoteAddress;
      return whitelistSet.has(ip);
    },
    handler: (req, res, next, opts) => {
      const ip = req.ip || req.connection.remoteAddress;

      if (blacklistSet.has(ip)) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Access denied'
        });
      }

      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: opts.message,
        retryAfter: Math.ceil((opts.resetTime.getTime() - Date.now()) / 1000)
      });
    }
  });
}

/**
 * Create cost-based rate limiter
 */
function costBasedLimiter(options = {}) {
  const {
    budget = 1000, // Total budget per window
    windowMs = 60 * 1000,
    costs = {}, // { '/api/heavy': 10, '/api/light': 1 }
    defaultCost = 1,
    keyGenerator = (req) => req.ip,
    ...rest
  } = options;

  const budgets = new Map();

  return (req, res, next) => {
    const key = keyGenerator(req, res);
    const path = req.path;
    const cost = costs[path] || defaultCost;
    const now = Date.now();

    let data = budgets.get(key);

    if (!data || data.resetTime < now) {
      data = {
        spent: 0,
        resetTime: now + windowMs
      };
    }

    data.spent += cost;
    budgets.set(key, data);

    // Set headers
    res.setHeader('X-Budget-Limit', budget);
    res.setHeader('X-Budget-Remaining', Math.max(0, budget - data.spent));
    res.setHeader('X-Budget-Cost', cost);

    if (data.spent > budget) {
      logger.warn('Budget exceeded', { key, spent: data.spent, budget });

      return res.status(429).json({
        error: 'BUDGET_EXCEEDED',
        message: 'Request budget exceeded',
        spent: data.spent,
        budget,
        cost,
        retryAfter: Math.ceil((data.resetTime - now) / 1000)
      });
    }

    next();
  };
}

module.exports = rateLimiter;
module.exports.rateLimiter = rateLimiter;
module.exports.createMemoryStore = createMemoryStore;
module.exports.slidingWindowLimiter = slidingWindowLimiter;
module.exports.tokenBucketLimiter = tokenBucketLimiter;
module.exports.tieredLimiter = tieredLimiter;
module.exports.ipRateLimiter = ipRateLimiter;
module.exports.costBasedLimiter = costBasedLimiter;