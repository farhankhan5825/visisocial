/**
 * Async Wrapper Utility
 * Wraps async route handlers to catch errors and pass to Express error handler
 * @version 2.0.0
 */

/**
 * Wrap an async function to handle errors
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function that catches errors
 */
function wrapAsync(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Wrap multiple middleware functions
 * @param {...Function} fns - Functions to wrap
 * @returns {Function[]} Array of wrapped functions
 */
wrapAsync.all = function (...fns) {
  return fns.map(fn => wrapAsync(fn));
};

/**
 * Create a wrapped router method
 * @param {Object} router - Express router
 * @param {string} method - HTTP method
 * @returns {Function} Wrapped method
 */
wrapAsync.method = function (router, method) {
  const original = router[method].bind(router);
  return function (path, ...handlers) {
    const wrappedHandlers = handlers.map(handler => {
      if (typeof handler === 'function') {
        return wrapAsync(handler);
      }
      return handler;
    });
    return original(path, ...wrappedHandlers);
  };
};

/**
 * Wrap all methods on a router
 * @param {Object} router - Express router
 * @returns {Object} Router with wrapped methods
 */
wrapAsync.router = function (router) {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'all'];
  methods.forEach(method => {
    router[method] = wrapAsync.method(router, method);
  });
  return router;
};

module.exports = wrapAsync;