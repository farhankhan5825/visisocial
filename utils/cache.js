/**
 * Cache Utility
 * 
 * A flexible caching system with support for both in-memory and Redis caching.
 * Falls back to in-memory cache if Redis is not available.
 */

// utils/cache.js

const Redis = require('ioredis');
const logger = require('./logger');

// Cache configuration
const CACHE_TTL = 60 * 60; // Default TTL: 1 hour (in seconds)
const REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const CACHE_PREFIX = process.env.CACHE_PREFIX || 'visisocial:cache:';

// In-memory cache store
const memoryCache = new Map();

// Redis client
let redisClient = null;

// Initialize Redis if enabled
if (REDIS_ENABLED) {
  try {
    redisClient = new Redis(REDIS_URL, {
      password: REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });

    redisClient.on('connect', () => {
      logger.info('Redis cache connected successfully');
    });

    redisClient.on('error', (error) => {
      logger.error(`Redis cache error: ${error.message}`);
    });

    redisClient.on('reconnecting', () => {
      logger.warn('Redis cache reconnecting...');
    });
  } catch (error) {
    logger.error(`Failed to initialize Redis cache: ${error.message}`);
    redisClient = null;
  }
}

/**
 * Cache implementation
 */
const cache = {
  /**
   * Check if Redis cache is available
   * @returns {boolean} True if Redis is available
   */
  isRedisAvailable() {
    return redisClient !== null && redisClient.status === 'ready';
  },

  /**
   * Check if any cache is available
   * @returns {boolean} True if any cache is available
   */
  isAvailable() {
    return true; // Memory cache is always available
  },

  /**
   * Get Redis client instance
   * @returns {Redis|null} Redis client instance or null if Redis is not available
   */
  get redisClient() {
    return redisClient;
  },

  /**
   * Format a cache key with prefix
   * @param {string} key - Cache key
   * @returns {string} Formatted cache key
   */
  formatKey(key) {
    return `${CACHE_PREFIX}${key}`;
  },

  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (optional)
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, ttl = null) {
    if (!key) {
      logger.warn('Cache set: Missing key');
      return false;
    }

    try {
      const formattedKey = this.formatKey(key);
      const serializedValue = JSON.stringify(value);
      
      // Calculate TTL
      const ttlSeconds = ttl ? Math.floor(ttl / 1000) : CACHE_TTL;
      
      // Try Redis first if available
      if (this.isRedisAvailable()) {
        await redisClient.set(formattedKey, serializedValue, 'EX', ttlSeconds);
        logger.debug(`Redis cache set: ${key} (TTL: ${ttlSeconds}s)`);
        return true;
      }
      
      // Fall back to memory cache
      const expiresAt = ttl ? Date.now() + ttl : null;
      memoryCache.set(formattedKey, {
        value: serializedValue,
        expiresAt
      });
      
      logger.debug(`Memory cache set: ${key} ${ttl ? `(TTL: ${ttl}ms)` : '(no expiration)'}`);
      return true;
    } catch (error) {
      logger.error(`Cache set error for key ${key}: ${error.message}`);
      return false;
    }
  },

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {Promise<*>} Cached value or null if not found
   */
  async get(key) {
    if (!key) {
      logger.warn('Cache get: Missing key');
      return null;
    }

    try {
      const formattedKey = this.formatKey(key);
      
      // Try Redis first if available
      if (this.isRedisAvailable()) {
        const value = await redisClient.get(formattedKey);
        
        if (value) {
          logger.debug(`Redis cache hit: ${key}`);
          return JSON.parse(value);
        }
        
        logger.debug(`Redis cache miss: ${key}`);
        return null;
      }
      
      // Fall back to memory cache
      const cachedItem = memoryCache.get(formattedKey);
      
      if (!cachedItem) {
        logger.debug(`Memory cache miss: ${key}`);
        return null;
      }
      
      // Check if value has expired
      if (cachedItem.expiresAt && cachedItem.expiresAt < Date.now()) {
        memoryCache.delete(formattedKey);
        logger.debug(`Memory cache expired: ${key}`);
        return null;
      }
      
      logger.debug(`Memory cache hit: ${key}`);
      return JSON.parse(cachedItem.value);
    } catch (error) {
      logger.error(`Cache get error for key ${key}: ${error.message}`);
      return null;
    }
  },

  /**
   * Return number of items in cache
   * @returns {Promise<number>} Number of items in cache
   */
  async countItems() {
    if (this.isRedisAvailable()) {
      const count = await redisClient.dbsize(); // total keys in Redis
      return count;
    }
    return memoryCache.size;
  },

  /**
   * Return approximate size of cache in KB
   * @returns {Promise<number>} Size of cache in KB
   */
  async sizeKB() {
    let totalBytes = 0;

    if (this.isRedisAvailable()) {
      const keys = await redisClient.keys('*');
      for (const key of keys) {
        const val = await redisClient.get(key);
        totalBytes += Buffer.byteLength(val || '', 'utf8');
      }
    } else {
      for (const item of memoryCache.values()) {
        totalBytes += Buffer.byteLength(item.value || '', 'utf8');
      }
    }

    return Math.round(totalBytes / 1024); // KB
  },


  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async del(key) {
    if (!key) {
      logger.warn('Cache delete: Missing key');
      return false;
    }

    try {
      const formattedKey = this.formatKey(key);
      
      // Try Redis first if available
      if (this.isRedisAvailable()) {
        await redisClient.del(formattedKey);
      }
      
      // Also remove from memory cache
      memoryCache.delete(formattedKey);
      
      logger.debug(`Cache delete: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Cache delete error for key ${key}: ${error.message}`);
      return false;
    }
  },

  /**
   * Check if a key exists in cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} True if key exists
   */
  async exists(key) {
    if (!key) {
      return false;
    }

    try {
      const formattedKey = this.formatKey(key);
      
      // Try Redis first if available
      if (this.isRedisAvailable()) {
        const exists = await redisClient.exists(formattedKey);
        return exists === 1;
      }
      
      // Fall back to memory cache
      const cachedItem = memoryCache.get(formattedKey);
      
      if (!cachedItem) {
        return false;
      }
      
      // Check if value has expired
      if (cachedItem.expiresAt && cachedItem.expiresAt < Date.now()) {
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error(`Cache exists error for key ${key}: ${error.message}`);
      return false;
    }
  },

  /**
   * Increment a value in cache
   * @param {string} key - Cache key
   * @param {number} value - Value to increment by (default: 1)
   * @returns {Promise<number|null>} New value or null on error
   */
  async increment(key, value = 1) {
    if (!key) {
      logger.warn('Cache increment: Missing key');
      return null;
    }

    try {
      const formattedKey = this.formatKey(key);
      
      // Try Redis first if available
      if (this.isRedisAvailable()) {
        const newValue = await redisClient.incrby(formattedKey, value);
        logger.debug(`Redis cache increment: ${key} by ${value}, new value: ${newValue}`);
        return newValue;
      }
      
      // Fall back to memory cache
      let cachedItem = memoryCache.get(formattedKey);
      
      if (!cachedItem) {
        // Initialize with 0
        cachedItem = {
          value: '0',
          expiresAt: null
        };
      } else if (cachedItem.expiresAt && cachedItem.expiresAt < Date.now()) {
        // Reset expired value
        cachedItem = {
          value: '0',
          expiresAt: null
        };
      }
      
      // Parse current value, increment, and update
      const currentValue = parseInt(JSON.parse(cachedItem.value) || 0, 10);
      const newValue = currentValue + value;
      
      cachedItem.value = JSON.stringify(newValue);
      memoryCache.set(formattedKey, cachedItem);
      
      logger.debug(`Memory cache increment: ${key} by ${value}, new value: ${newValue}`);
      return newValue;
    } catch (error) {
      logger.error(`Cache increment error for key ${key}: ${error.message}`);
      return null;
    }
  },

  /**
   * Get many values from cache
   * @param {string[]} keys - Array of cache keys
   * @returns {Promise<Object>} Object with key-value pairs
   */
  async getMany(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return {};
    }

    const result = {};

    try {
      // Try Redis first if available
      if (this.isRedisAvailable()) {
        const formattedKeys = keys.map(key => this.formatKey(key));
        const values = await redisClient.mget(formattedKeys);
        
        keys.forEach((key, index) => {
          if (values[index]) {
            result[key] = JSON.parse(values[index]);
          } else {
            result[key] = null;
          }
        });
        
        return result;
      }
      
      // Fall back to memory cache
      for (const key of keys) {
        result[key] = await this.get(key);
      }
      
      return result;
    } catch (error) {
      logger.error(`Cache getMany error: ${error.message}`);
      
      // Try to get individual keys as fallback
      for (const key of keys) {
        try {
          result[key] = await this.get(key);
        } catch (error) {
          result[key] = null;
        }
      }
      
      return result;
    }
  },

  /**
   * Clear all cache entries with a specific prefix
   * @param {string} prefix - Prefix to match
   * @returns {Promise<boolean>} Success status
   */
  async clearPrefix(prefix) {
    if (!prefix) {
      logger.warn('Cache clearPrefix: Missing prefix');
      return false;
    }

    try {
      const fullPrefix = this.formatKey(prefix);
      
      // Clear from Redis if available
      if (this.isRedisAvailable()) {
        // Get all keys with prefix
        const keys = await redisClient.keys(`${fullPrefix}*`);
        
        if (keys.length > 0) {
          await redisClient.del(...keys);
          logger.debug(`Redis cache cleared ${keys.length} keys with prefix: ${prefix}`);
        }
      }
      
      // Clear from memory cache
      let count = 0;
      for (const key of memoryCache.keys()) {
        if (key.startsWith(fullPrefix)) {
          memoryCache.delete(key);
          count++;
        }
      }
      
      if (count > 0) {
        logger.debug(`Memory cache cleared ${count} keys with prefix: ${prefix}`);
      }
      
      return true;
    } catch (error) {
      logger.error(`Cache clearPrefix error for prefix ${prefix}: ${error.message}`);
      return false;
    }
  },

  /**
   * Clear all cache
   * @returns {Promise<boolean>} Success status
   */
  async clear() {
    try {
      // Clear Redis if available
      if (this.isRedisAvailable()) {
        // Get all keys with our prefix
        const keys = await redisClient.keys(`${CACHE_PREFIX}*`);
        
        if (keys.length > 0) {
          await redisClient.del(...keys);
          logger.info(`Redis cache cleared ${keys.length} keys`);
        }
      }
      
      // Clear memory cache
      const count = memoryCache.size;
      memoryCache.clear();
      
      if (count > 0) {
        logger.info(`Memory cache cleared ${count} keys`);
      }
      
      return true;
    } catch (error) {
      logger.error(`Cache clear error: ${error.message}`);
      return false;
    }
  },

  /**
   * Get cache stats
   * @returns {Promise<Object>} Cache statistics
   */
  async getStats() {
    try {
      const stats = {
        memory: {
          size: memoryCache.size,
          type: 'memory'
        },
        redis: {
          connected: this.isRedisAvailable(),
          type: 'redis'
        }
      };
      
      // Add Redis stats if available
      if (this.isRedisAvailable()) {
        const info = await redisClient.info();
        const keyCount = await redisClient.dbsize();
        
        stats.redis.keys = keyCount;
        stats.redis.info = info
          .split('\n')
          .filter(line => line.includes(':'))
          .reduce((obj, line) => {
            const [key, value] = line.split(':');
            obj[key.trim()] = value.trim();
            return obj;
          }, {});
      }
      
      return stats;
    } catch (error) {
      logger.error(`Cache stats error: ${error.message}`);
      return {
        memory: { size: memoryCache.size, type: 'memory' },
        redis: { connected: false, type: 'redis', error: error.message }
      };
    }
  },

  /**
   * Create a rate limit store for express-rate-limit
   * @returns {Object} Rate limit store
   */
  createRateLimitStore() {
    return {
      /**
       * Increment rate limit counter
       * @param {string} key - Rate limit key
       * @param {Object} options - Rate limit options
       * @returns {Promise<Object>} Current rate limit info
       */
      async increment(key, options) {
        const ttl = options.windowMs;
        const resetTime = Date.now() + ttl;
        
        let counter;
        let ttlRemainingMs;
        
        // Try Redis first
        if (cache.isRedisAvailable()) {
          const prefixedKey = `${CACHE_PREFIX}ratelimit:${key}`;
          
          // Check if key exists
          const exists = await redisClient.exists(prefixedKey);
          
          if (!exists) {
            // New rate limit
            await redisClient.set(prefixedKey, 1, 'PX', ttl);
            counter = 1;
            ttlRemainingMs = ttl;
          } else {
            // Increment existing counter
            counter = await redisClient.incr(prefixedKey);
            
            // Get TTL
            const pttl = await redisClient.pttl(prefixedKey);
            ttlRemainingMs = pttl > 0 ? pttl : 0;
          }
        } else {
          // Fall back to memory cache
          const prefixedKey = `${CACHE_PREFIX}ratelimit:${key}`;
          const cachedItem = memoryCache.get(prefixedKey);
          
          if (!cachedItem) {
            // New rate limit
            memoryCache.set(prefixedKey, {
              value: '1',
              expiresAt: resetTime
            });
            counter = 1;
            ttlRemainingMs = ttl;
          } else {
            // Check if rate limit has expired
            if (cachedItem.expiresAt < Date.now()) {
              // Reset rate limit
              memoryCache.set(prefixedKey, {
                value: '1',
                expiresAt: resetTime
              });
              counter = 1;
              ttlRemainingMs = ttl;
            } else {
              // Increment counter
              counter = parseInt(cachedItem.value, 10) + 1;
              cachedItem.value = counter.toString();
              ttlRemainingMs = cachedItem.expiresAt - Date.now();
            }
          }
        }
        
        return {
          totalHits: counter,
          resetTime: new Date(Date.now() + ttlRemainingMs),
          remainingHits: Math.max(0, options.max - counter)
        };
      },
      
      /**
       * Decrement rate limit counter
       * @param {string} key - Rate limit key
       * @returns {Promise<void>}
       */
      async decrement(key) {
        const prefixedKey = `${CACHE_PREFIX}ratelimit:${key}`;
        
        // Try Redis first
        if (cache.isRedisAvailable()) {
          const exists = await redisClient.exists(prefixedKey);
          
          if (exists) {
            await redisClient.decr(prefixedKey);
          }
        } else {
          // Fall back to memory cache
          const cachedItem = memoryCache.get(prefixedKey);
          
          if (cachedItem && cachedItem.expiresAt > Date.now()) {
            const counter = Math.max(0, parseInt(cachedItem.value, 10) - 1);
            cachedItem.value = counter.toString();
          }
        }
      },
      
      /**
       * Reset rate limit counter
       * @param {string} key - Rate limit key
       * @returns {Promise<void>}
       */
      async resetKey(key) {
        const prefixedKey = `${CACHE_PREFIX}ratelimit:${key}`;
        
        // Try Redis first
        if (cache.isRedisAvailable()) {
          await redisClient.del(prefixedKey);
        } else {
          // Fall back to memory cache
          memoryCache.delete(prefixedKey);
        }
      },
      
      /**
       * Reset all rate limit counters
       * @returns {Promise<void>}
       */
      async resetAll() {
        return cache.clearPrefix('ratelimit:');
      }
    };
  }
};

// Clean up expired values from memory cache
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;
  
  for (const [key, item] of memoryCache.entries()) {
    if (item.expiresAt && item.expiresAt < now) {
      memoryCache.delete(key);
      expiredCount++;
    }
  }
  
  if (expiredCount > 0) {
    logger.debug(`Removed ${expiredCount} expired items from memory cache`);
  }
}, 60000); // Clean every minute

// Handle graceful shutdown
process.on('SIGTERM', () => {
  if (redisClient) {
    redisClient.quit();
  }
});

module.exports = cache;