/**
 * Express Error Utility
 * Custom error class for Express with status codes and error details
 * @version 2.0.0
 */

class ExpressError extends Error {
  /**
   * Create a new ExpressError
   * @param {string} message - Error message
   * @param {number} status - HTTP status code (default: 500)
   * @param {Object} options - Additional options
   */
  constructor(message, status = 500, options = {}) {
    super(message);
    this.name = 'ExpressError';
    this.status = status;
    this.statusCode = status; // Alias for compatibility
    this.code = options.code || this._getDefaultCode(status);
    this.details = options.details || null;
    this.isOperational = options.isOperational !== false;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get default error code based on status
   */
  _getDefaultCode(status) {
    const codes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      405: 'METHOD_NOT_ALLOWED',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
      504: 'GATEWAY_TIMEOUT'
    };
    return codes[status] || 'ERROR';
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      error: {
        message: this.message,
        code: this.code,
        status: this.status,
        details: this.details
      }
    };
  }

  /**
   * Create a 400 Bad Request error
   */
  static badRequest(message = 'Bad Request', details = null) {
    return new ExpressError(message, 400, { details });
  }

  /**
   * Create a 401 Unauthorized error
   */
  static unauthorized(message = 'Unauthorized', details = null) {
    return new ExpressError(message, 401, { details });
  }

  /**
   * Create a 403 Forbidden error
   */
  static forbidden(message = 'Forbidden', details = null) {
    return new ExpressError(message, 403, { details });
  }

  /**
   * Create a 404 Not Found error
   */
  static notFound(message = 'Not Found', details = null) {
    return new ExpressError(message, 404, { details });
  }

  /**
   * Create a 409 Conflict error
   */
  static conflict(message = 'Conflict', details = null) {
    return new ExpressError(message, 409, { details });
  }

  /**
   * Create a 422 Unprocessable Entity error
   */
  static unprocessable(message = 'Unprocessable Entity', details = null) {
    return new ExpressError(message, 422, { details });
  }

  /**
   * Create a 429 Too Many Requests error
   */
  static tooManyRequests(message = 'Too Many Requests', details = null) {
    return new ExpressError(message, 429, { details });
  }

  /**
   * Create a 500 Internal Server Error
   */
  static internal(message = 'Internal Server Error', details = null) {
    return new ExpressError(message, 500, { details, isOperational: false });
  }

  /**
   * Create a 503 Service Unavailable error
   */
  static serviceUnavailable(message = 'Service Unavailable', details = null) {
    return new ExpressError(message, 503, { details });
  }

  /**
   * Create error from existing error
   */
  static from(error, status = 500) {
    if (error instanceof ExpressError) {
      return error;
    }

    const expressError = new ExpressError(error.message, status);
    expressError.stack = error.stack;
    expressError.originalError = error;

    return expressError;
  }

  /**
   * Check if error is an ExpressError
   */
  static isExpressError(error) {
    return error instanceof ExpressError;
  }
}

module.exports = ExpressError;