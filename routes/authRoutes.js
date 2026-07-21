/**
 * Authentication Routes
 * Complete auth handling: OAuth, session, token management
 * @version 2.0.0
 */

// route: routes/authRoutes.js
 

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');

const UserToken = require('../models/UserToken');
const User = require('../models/User');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const analytics = require('../utils/analytics');
const loadingStates = require('../utils/loadingStates');
const cache = require('../utils/cache');
const config = require('../config/appConfig');
const wrapAsync = require('../utils/wrapAsync');
const Admin = require('../models/Admin'); // <-- Use Admin model

// Rate limiting for auth routes
const rateLimiter = require('../utils/rateLimiter');
const authLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: 'Too many authentication attempts, please try again later'
});



/**
 * GET /auth/check
 * Quick auth check (lighter than /status)
 */
router.get('/check', (req, res) => {
  res.json({
    authenticated: !!req.cookies.access_token,
    timestamp: Date.now()
  });
});


/**
 * GET /adminlogin
 * Render admin login page
 */
router.get('/adminlogin', (req, res) => {
  res.render('admin/adminLogin', {
    title: 'Admin Login',
    currentPage: 'login',
    message: req.query.message || null,
    error: req.query.error || null
  });
});

/**
 * POST /adminlogin
 * Authenticate admin credentials
 */
router.post('/adminlogin', wrapAsync(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.redirect('/adminlogin?error=Missing+email+or+password');
  }

  // Look up admin account
  const admin = await Admin.findOne({ email });
  if (!admin) {
    return res.redirect('/adminlogin?error=Admin+not+found');
  }

  // Check password
  const passwordMatch = await admin.comparePassword(password);
  if (!passwordMatch) {
    return res.redirect('/adminlogin?error=Invalid+credentials');
  }

  // Check status
  if (admin.status !== 'active') {
    return res.redirect('/adminlogin?error=Account+disabled');
  }

  // Create session token
  const accessToken = crypto.randomBytes(48).toString('hex');
  await UserToken.create({
    userId: admin.id,
    accessToken,
    isValid: true,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + config.session.maxAge),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent']
  });

  // Set cookie for admin authentication
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: config.server.isProduction,
    maxAge: config.session.maxAge,
    sameSite: 'strict'
  });

  // Track metrics & analytics
  analytics.track('admin_login', { adminId: admin.id });
  metrics.increment('admin.login');

  // Redirect to admin dashboard
  res.redirect('/admin?welcome=admin');
}));



/**
 * GET /auth/logout
 * Handle user logout
 */
router.get('/logout', wrapAsync(async (req, res) => {
  const userId = res.locals.user?.id;
  const token = req.cookies.access_token;

  // Track logout
  if (userId) {
    analytics.track('auth_logout', { userId });
    metrics.increment('auth.logout');

    // Invalidate token in database
    try {
      await UserToken.findOneAndUpdate(
        { userId, accessToken: token },
        {
          isValid: false,
          revokedAt: new Date(),
          revokedReason: 'user_logout'
        }
      );
    } catch (err) {
      logger.error('Failed to invalidate token', { error: err.message });
    }

    // Clear user from cache
    await cache.del(`auth_${token}`);
    await cache.del(`user_${userId}`);

    // Emit logout event via socket if available
    const io = req.app.get('socketio');
    if (io) {
      io.to(userId).emit('logout', { success: true });
    }

    logger.info(`User logged out: ${userId}`);
  }

  // Clear all auth-related cookies
  res.clearCookie('access_token');
  res.clearCookie('loading_state_id');
  res.clearCookie('session_id');

  // Destroy session
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        logger.error('Session destruction error', { error: err.message });
      }
    });
  }

  // Redirect or respond based on request type
  if (req.accepts('json') && req.xhr) {
    return res.json({ success: true, message: 'Logged out successfully' });
  }

  res.redirect('/login?message=Successfully+logged+out');
}));

/**
 * POST /auth/logout
 * Handle user logout (POST version for forms/AJAX)
 */
router.post('/logout', (req, res) => {
  // Delegate to GET handler
  req.method = 'GET';
  router.handle(req, res);
});

/**
 * GET /auth/refresh
 * Refresh authentication token
 */
router.get('/refresh', authLimiter, wrapAsync(async (req, res) => {
  const token = req.cookies.access_token;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'NO_TOKEN',
      message: 'No authentication token found'
    });
  }

  const userToken = await UserToken.findOne({ accessToken: token, isValid: true });

  if (!userToken) {
    res.clearCookie('access_token');
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired token'
    });
  }

  // Extend token expiry
  const newExpiry = new Date(Date.now() + config.session.maxAge);
  userToken.expiresAt = newExpiry;
  userToken.lastUsed = new Date();
  await userToken.save();

  // Update cookie
  res.cookie('access_token', token, {
    httpOnly: true,
    secure: config.server.isProduction,
    maxAge: config.session.maxAge,
    sameSite: config.session.sameSite
  });

  metrics.increment('auth.token_refresh');

  res.json({
    success: true,
    expiresAt: newExpiry.toISOString()
  });
}));

/**
 * GET /auth/sessions
 * Get user's active sessions
 */
router.get('/sessions', wrapAsync(async (req, res) => {
  const userId = res.locals.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Authentication required'
    });
  }

  const sessions = await UserToken.find({
    userId,
    isValid: true,
    expiresAt: { $gt: new Date() }
  }).select('createdAt lastUsed ipAddress userAgent expiresAt');

  res.json({
    success: true,
    sessions: sessions.map(s => ({
      id: s._id,
      createdAt: s.createdAt,
      lastUsed: s.lastUsed,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      expiresAt: s.expiresAt,
      current: s.accessToken === req.cookies.access_token
    }))
  });
}));

/**
 * DELETE /auth/sessions/:id
 * Revoke a specific session
 */
router.delete('/sessions/:id', wrapAsync(async (req, res) => {
  const userId = res.locals.user?.id;
  const sessionId = req.params.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED'
    });
  }

  const result = await UserToken.findOneAndUpdate(
    { _id: sessionId, userId },
    {
      isValid: false,
      revokedAt: new Date(),
      revokedReason: 'user_revoked'
    }
  );

  if (!result) {
    return res.status(404).json({
      success: false,
      error: 'SESSION_NOT_FOUND'
    });
  }

  metrics.increment('auth.session_revoked');

  res.json({
    success: true,
    message: 'Session revoked successfully'
  });
}));

/**
 * POST /auth/sessions/revoke-all
 * Revoke all sessions except current
 */
router.post('/sessions/revoke-all', wrapAsync(async (req, res) => {
  const userId = res.locals.user?.id;
  const currentToken = req.cookies.access_token;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED'
    });
  }

  const result = await UserToken.updateMany(
    {
      userId,
      accessToken: { $ne: currentToken },
      isValid: true
    },
    {
      isValid: false,
      revokedAt: new Date(),
      revokedReason: 'user_revoked_all'
    }
  );

  metrics.increment('auth.sessions_revoked_all');
  logger.info(`User revoked all sessions: ${userId}`, { count: result.modifiedCount });

  res.json({
    success: true,
    revokedCount: result.modifiedCount
  });
}));




/**
 * GET /auth/me
 * Get current user profile
 */
router.get('/me', wrapAsync(async (req, res) => {
  const userId = res.locals.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED'
    });
  }

  // Check cache first
  const cacheKey = `user_profile_${userId}`;
  let user = await cache.get(cacheKey);

  if (!user) {
    user = await User.findOne({ id: userId }).select('-__v');

    if (user) {
      await cache.set(cacheKey, user, 5 * 60 * 1000); // 5 minutes
    }
  }

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.picture,
      gender: user.gender,
      location: user.location,
      createdAt: user.createdAt,
      lastUpdated: user.lastUpdated,
      personalityScores: user.personalityScores,
      areaOfInterest: user.areaOfInterest
    }
  });
}));

/**
 * GET /auth/providers
 * Get available auth providers
 */
router.get('/providers', (req, res) => {
  res.json({
    providers: [
      {
        id: 'facebook',
        name: 'Facebook',
        enabled: !!config.facebook.appId,
        url: '/auth/facebook'
      }
    ]
  });
});


// Privacy Policy
router.get('/privacy', (req, res) => {
    res.render('privacy', { 
        title: 'Privacy Policy',
        currentPage: 'privacy',
        user: req.user || null,
        userData: req.user || null
    });
});

// Terms of Service
router.get('/terms', (req, res) => {
    res.render('terms', { 
        title: 'Terms of Service',
        currentPage: 'terms',
        user: req.user || null,
        userData: req.user || null
    });
});

// Cookie Policy
router.get('/cookies', (req, res) => {
    res.render('cookies', { 
        title: 'Cookie Policy',
        currentPage: 'cookies',
        user: req.user || null,
        userData: req.user || null
    });
});

// API Documentation
router.get('/docs', (req, res) => {
    res.render('docs', { 
        title: 'API Documentation',
        currentPage: 'docs',
        user: req.user || null,
        userData: req.user || null
    });
});

// Support Center
router.get('/support', (req, res) => {
    res.render('support', { 
        title: 'Support Center',
        currentPage: 'support',
        user: req.user || null,
        userData: req.user || null
    });
});

// Data Deletion 
router.get('/data', (req, res) => {
    res.render('data', { 
        title: 'Data Deletion',
        currentPage: 'data',
        user: req.user || null,
        userData: req.user || null
    });
});

// Contact Page (GET)
router.get('/contact', (req, res) => {
    res.render('contact', {
        title: 'Contact Us',
        currentPage: 'contact',
        user: req.user || null,
        userData: req.user || null
    });
});

// Contact Form Submission (POST)
router.post('/contact', async (req, res, next) => {
    try {
        const { name, email, subject, message } = req.body;

        // Basic validation
        if (!name || !email || !subject || !message) {
            return res.status(400).render('contact', {
                title: 'Contact Us',
                currentPage: 'contact',
                user: req.user || null,
                userData: req.user || null,
                error: 'All fields are required.'
            });
        }

        // TODO: replace with SendGrid / email / DB logic
        console.log('📩 Contact form submission:', {
            name,
            email,
            subject,
            message
        });

        res.render('contact', {
            title: 'Contact Us',
            currentPage: 'contact',
            user: req.user || null,
            userData: req.user || null,
            success: 'Your message has been sent successfully. We will get back to you within 24–48 hours.'
        });

    } catch (err) {
        next(err);
    }
});


// System Status
router.get('/status', (req, res) => {
  const authenticated = !!res.locals.user; // or your isAuthenticated check
  const userData = authenticated ? {
    id: res.locals.user.id,
    name: res.locals.user.name,
    picture: res.locals.user.picture
  } : null;

  res.render('status', { 
    title: 'System Status',
    currentPage: 'status',
    authenticated,
    user: userData,
    timestamp: new Date().toISOString()
  });
});



/**
 * POST /auth/verify-token
 * Verify a token is valid (for API clients)
 */
router.post('/verify-token', wrapAsync(async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      valid: false,
      error: 'TOKEN_REQUIRED'
    });
  }

  const userToken = await UserToken.findOne({
    accessToken: token,
    isValid: true,
    expiresAt: { $gt: new Date() }
  });

  if (!userToken) {
    return res.json({
      valid: false,
      error: 'INVALID_TOKEN'
    });
  }

  // Update last used
  userToken.lastUsed = new Date();
  await userToken.save();

  res.json({
    valid: true,
    userId: userToken.userId,
    expiresAt: userToken.expiresAt
  });
}));

/**
 * GET /auth/csrf
 * Get CSRF token for forms
 */
router.get('/csrf', (req, res) => {
  const csrfToken = crypto.randomBytes(32).toString('hex');

  // Store in session
  if (req.session) {
    req.session.csrfToken = csrfToken;
  }

  res.json({
    csrfToken
  });
});

/**
 * Middleware to verify CSRF token
 */
router.verifyCsrf = (req, res, next) => {
  const token = req.body._csrf || req.headers['x-csrf-token'];
  const sessionToken = req.session?.csrfToken;

  if (!token || !sessionToken || token !== sessionToken) {
    return res.status(403).json({
      success: false,
      error: 'CSRF_VALIDATION_FAILED',
      message: 'Invalid or missing CSRF token'
    });
  }

  next();
};

/**
 * GET /auth/loading-status
 * Get loading status for auth flow
 */
router.get('/loading-status', (req, res) => {
  const loadingStateId = req.query.id || req.cookies.loading_state_id;

  if (!loadingStateId) {
    return res.json({
      status: 'unknown',
      progress: 0,
      message: 'No loading state found'
    });
  }

  const state = loadingStates.get(loadingStateId);

  res.json(state || {
    status: 'unknown',
    progress: 0,
    message: 'Loading state not found or expired'
  });
});

/**
 * Error handler for auth routes
 */
router.use((err, req, res, next) => {
  logger.error('Auth route error', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });

  metrics.increment('auth.errors');

  if (req.accepts('json')) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.code || 'AUTH_ERROR',
      message: config.server.isProduction
        ? 'An authentication error occurred'
        : err.message
    });
  }

  res.redirect('/login?error=Authentication+error');
});

module.exports = router;