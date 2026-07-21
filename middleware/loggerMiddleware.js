// middleware/loggerMiddleware.js

const crypto = require('crypto');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

/**
 * Request logging middleware
 */
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  // Assign a traceable request id once; downstream middleware reuses it
  if (!req.id) {
    req.id = req.headers['x-request-id'] || crypto.randomBytes(6).toString('hex');
  }
  const requestId = req.id;

  // Log incoming request
  logger.debug(`[${requestId}] ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    userId: req.user?.id || 'anonymous'
  });

  // Track request metrics
  metrics.increment('http.requests');
  metrics.increment(`http.requests.${req.method.toLowerCase()}`);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      ip: req.ip,
      userId: req.user?.id || 'anonymous',
      userAgent: req.headers['user-agent']
    };

    // Different logging levels based on status code
    if (res.statusCode >= 500) {
      logger.error(`[${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, logData);
    } else if (res.statusCode >= 400) {
      logger.warn(`[${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, logData);
    } else {
      logger.info(`[${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, logData);
    }

    // Track response metrics
    metrics.timing('http.response_time', duration);
    metrics.increment(`http.responses.${Math.floor(res.statusCode / 100)}xx`);
  });

  next();
};

/**
 * Error logging middleware
 */
const errorLogger = (err, req, res, next) => {
  const requestId = req.id || 'unknown';

  logger.error(`[${requestId}] Unhandled error: ${err.message}`, {
    requestId,
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id || 'anonymous'
  });

  metrics.increment('errors.unhandled');
  next(err);
};

/**
 * Performance monitoring middleware
 */
const performanceMonitor = (req, res, next) => {
  const startTime = Date.now();
  const requestId = req.id || 'unknown';

  // Monitor memory usage
  const initialMemory = process.memoryUsage();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const finalMemory = process.memoryUsage();

    // Log performance data
    logger.debug(`[${requestId}] Performance metrics`, {
      requestId,
      duration,
      memoryDelta: {
        rss: finalMemory.rss - initialMemory.rss,
        heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
        heapUsed: finalMemory.heapUsed - initialMemory.heapUsed
      },
      url: req.originalUrl,
      method: req.method
    });

    // Track performance metrics
    metrics.timing('performance.request_duration', duration);
    metrics.gauge('performance.memory_rss', finalMemory.rss);
    metrics.gauge('performance.memory_heap_used', finalMemory.heapUsed);

    // Alert on slow requests
    if (duration > 10000) { // 10 seconds
      logger.warn(`[${requestId}] Slow request detected: ${duration}ms`, {
        requestId,
        duration,
        url: req.originalUrl,
        method: req.method
      });
      metrics.increment('performance.slow_requests');
    }
  });

  next();
};

module.exports = {
  requestLogger,
  errorLogger,
  performanceMonitor
};
