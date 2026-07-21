// index.js
/**
 * VisiSocial - Advanced Social Media Analytics Platform
 * Enhanced Server Configuration
 * 
 * @version 2.0.0
 * @license MIT
 */

// Environment setup
  const dotenv = require('dotenv');
  dotenv.config();


// Core dependencies
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const passport = require('passport');
const FacebookStrategy = require('passport-facebook').Strategy;
const axios = require('axios');
const ejsMate = require('ejs-mate');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const flash = require('connect-flash');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const socketIO = require('socket.io');
const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const cron = require('node-cron');
const fileUpload = require('express-fileupload');
const serveIndex = require('serve-index');
const minify = require('express-minify');
const useragent = require('express-useragent');

// Custom modules
const ExpressError = require('./utils/ExpressError');
const UserToken = require('./models/UserToken');
const User = require('./models/User');
const connectDB = require('./config/db');
const homeRoute = require('./routes/homeRoute');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const apiRoutes = require('./routes/apiRoutes');
const taskStatus = require('./utils/taskStatus'); // Moved to utils
const logger = require('./utils/logger');
const analytics = require('./utils/analytics');
const cache = require('./utils/cache');
const metrics = require('./utils/metrics');
const { initializeBackgroundJobs } = require('./services/backgroundJobs');
const loadingStates = require('./utils/loadingStates');
const config = require('./config/appConfig');
const { requestLogger, errorLogger, performanceMonitor } = require('./middleware/loggerMiddleware');
const wrapAsync = require('./utils/wrapAsync');
const { processUserDataInBackground } = require('./routes/homeRoute');
const surveillanceRoutes = require('./routes/surveillanceRoutes');
const internetSearchRoutes = require('./routes/internetSearchRoutes');


// Constants
const PORT = process.env.PORT || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/visisocial';
const API_VERSION = process.env.API_VERSION || 'v14.0';
const CALLBACK_URL = IS_PRODUCTION
  ? process.env.PROD_CALLBACK_URL || 'https://socialms-304b304ec2aa.herokuapp.com/auth/facebook/callback'
  : process.env.DEV_CALLBACK_URL || `http://localhost:${PORT}/auth/facebook/callback`;
const TEMP_DIR = path.join(__dirname, 'temp');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const csvFilePath = path.join(__dirname, './extras/mypersonality_final.csv');

// Create Express app
const app = express();
const server = http.createServer(app);

// Socket.io for real-time updates
const io = socketIO(server, {
  cors: {
    origin: IS_PRODUCTION ? config.allowedOrigins : "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Initialize socket.io connection handlers
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  // Set up event handlers
  socket.on('join', (userId) => {
    socket.join(userId);
    logger.debug(`User ${userId} joined their room`);
  });

  socket.on('disconnect', () => {
    logger.debug(`Socket disconnected: ${socket.id}`);
  });
});

// Make io available globally
app.set('socketio', io);

// Create required directories
[TEMP_DIR, UPLOADS_DIR].forEach(dir => {
  const fs = require('fs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Database connection with improved error handling and retry logic
(async function initializeDatabase() {
  let retryCount = 0;
  const maxRetries = 5;
  
  while (retryCount < maxRetries) {
    try {
      await connectDB();
      logger.info('✅ Database connection established successfully');
      // Initialize background jobs after DB connection
      initializeBackgroundJobs();
      break;
    } catch (err) {
      retryCount++;
      const retryDelay = 5000 * retryCount; // Progressive backoff
      
      logger.error(`❌ Database connection error (attempt ${retryCount}/${maxRetries}):`, {
        message: err.message,
        code: err.code,
        name: err.name
      });
      
      if (retryCount >= maxRetries) {
        logger.error('❌ Maximum database connection retry attempts reached. Exiting process.');
        process.exit(1);
      }
      
      logger.info(`Retrying connection in ${retryDelay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
})();
app.use(requestLogger);        // Log all requests
app.use(performanceMonitor);   // Monitor performance
// Enhanced CSP configuration with more granular controls
const createCSP = (nonce) => {
  return {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],

      scriptSrc: [
        "'self'",
        `'nonce-${nonce}'`,
        "https://cdnjs.cloudflare.com",
        "https://code.jquery.com",
        "https://cdn.jsdelivr.net",
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/",
        "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/",
        "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/",
        "https://www.googletagmanager.com",
        "https://unpkg.com",
        ...(IS_PRODUCTION ? [] : ["'unsafe-eval'"])
      ],

      // ✅ FIX: Allow inline event handlers with nonce
      scriptSrcAttr: [
        "'self'",
        `'nonce-${nonce}'`,
        "'unsafe-hashes'"  // Required for inline event handlers like onclick
      ],

      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://cdn.jsdelivr.net",
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/",
        "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/",
        "https://cdnjs.cloudflare.com",
        "https://unpkg.com"
      ],

      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net",
        "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/",
        "https://cdnjs.cloudflare.com",
        "data:"
      ],

      imgSrc: [
        "'self'",
        "data:",
        "blob:",

        // Facebook
        "*.fbcdn.net",
        "*.fbsbx.com",
        "https://scontent.xx.fbcdn.net",
        "https://platform-lookaside.fbsbx.com",

        // Avatars / placeholders
        "https://www.gravatar.com",
        "https://via.placeholder.com",

        // ✅ FIX — add these
        "https://images.unsplash.com",
        "https://randomuser.me"
      ],

      connectSrc: [
        "'self'",
        "https://socialms-304b304ec2aa.herokuapp.com",
        "https://cluster0.wpnct76.mongodb.net",
        "https://graph.facebook.com",
        "https://www.google-analytics.com",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com",
        "wss://*.herokuapp.com",
        "ws://localhost:*"
      ],

      frameSrc: [
        "'self'",
        "https://www.youtube.com"
      ],

      mediaSrc: [
        "'self'",
        "https://static.cloudflareinsights.com"
      ],

      objectSrc: ["'none'"],

      upgradeInsecureRequests: IS_PRODUCTION ? [] : null
    },
    reportOnly: false
  };
};




// Advanced rate limiting with different tiers and dynamic adjustments
const createRateLimiter = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000, // Default: 15 minutes
    max: options.max || 100, // Default: 100 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    // Calculate limit based on user type
    keyGenerator: (req, res) => {
      // Use user ID if authenticated, IP otherwise
      return req.user?.id || req.ip;
    },
    skip: (req, res) => {
      // Skip rate limiting for certain conditions
      return req.path === '/health' || // Skip health checks
             (req.user?.isPremium && options.skipForPremium); // Skip for premium users if specified
    },
    handler: (req, res, next, options) => {
      logger.warn(`Rate limit exceeded: ${req.ip} ${req.method} ${req.originalUrl}`);
      metrics.increment('security.rate_limit_exceeded');
      
      // Different response format based on request type
      if (req.path.startsWith('/api/')) {
        return res.status(429).json({
          status: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later.',
          retryAfter: Math.ceil(options.windowMs / 1000)
        });
      } else {
        return res.status(429).render('error', {
          err: {
            status: 429,
            message: 'Too many requests, please try again later.',
            retryAfter: Math.ceil(options.windowMs / 1000)
          },
          title: 'Rate Limit Exceeded',
          nonce: res.locals.nonce
        });
      }
    },
    // Store rate limit data in Redis if available
    store: cache.redisClient ? cache.createRateLimitStore() : undefined
  });
};

// Configure rate limiters for different routes
const apiLimiter = createRateLimiter({ 
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // 150 requests per 15 minutes
  skipForPremium: true
});

const authLimiter = createRateLimiter({ 
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 login attempts per hour
  skipForPremium: false // Don't skip for premium users (security)
});

// Setup enhanced session store with MongoDB
const sessionStore = MongoStore.create({
  mongoUrl: MONGO_URI,
  touchAfter: 24 * 3600, // Reduce DB writes - update only once per day
  crypto: {
    secret: SESSION_SECRET,
  },
  ttl: 14 * 24 * 60 * 60, // 14 days
  autoRemove: 'native',
  collectionName: 'sessions'
});

// Middleware setup with enhanced options
app.use(morgan(IS_PRODUCTION ? 'combined' : 'dev')); // More detailed logging in production
app.use(compression({ level: 6, threshold: 0 })); // Compress all responses 
app.use(cookieParser(SESSION_SECRET)); // Parse cookies with signature

// Advanced body parsers with limits
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Security middleware
// Note: xss-clean was removed as it's deprecated. DOMPurify is used in routes for HTML sanitization.
app.use(mongoSanitize()); // Prevent MongoDB operator injection
app.use(cors({
  origin: IS_PRODUCTION ? config.allowedOrigins : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Method override for PUT/DELETE in forms
app.use(methodOverride('_method'));

// File upload with size limits and validation.
// Only run the parser on multipart requests so it doesn't log
// "Request is not eligible for file upload!" on every single request.
const fileUploadMiddleware = fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  abortOnLimit: true,
  createParentPath: true,
  useTempFiles: true,
  tempFileDir: TEMP_DIR,
  debug: false,
  safeFileNames: true,
  preserveExtension: true
});
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.startsWith('multipart/form-data')) {
    return fileUploadMiddleware(req, res, next);
  }
  next();
});

// User agent parsing
app.use(useragent.express());

// Session configuration
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: IS_PRODUCTION,
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    sameSite: IS_PRODUCTION ? 'strict' : 'lax'
  }
}));

// Flash messages
app.use(flash());

// Helmet for security headers with dynamic nonce for CSP
app.use((req, res, next) => {
  // Create a cryptographically secure nonce
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;
  
  // Set current timestamp for caching purposes
  res.locals.timestamp = Date.now();
  
  // Apply helmet with custom CSP
  helmet({
    contentSecurityPolicy: createCSP(nonce)
  })(req, res, next);
});

// Performance optimization - minify responses in production
if (IS_PRODUCTION) {
  app.use(minify({
    cache: TEMP_DIR + '/cache',
    uglifyJs: true,
    cssmin: true,
    errorHandler: (err, req, res, next) => {
      logger.error('Minification error:', err);
      next();
    }
  }));
}

// Static file serving with improved caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PRODUCTION ? '7d' : 0, // Cache for 7 days in production
  etag: true,
  lastModified: true
}));

// View engine setup with custom helpers
app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Add global template variables
app.use((req, res, next) => {
  // Add application version and environment
  res.locals.appVersion = require('./package.json').version;
  res.locals.environment = process.env.NODE_ENV;
  res.locals.isProduction = IS_PRODUCTION;
  
  // Add flash messages
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.info = req.flash('info');
  
  // Add loading states management
  res.locals.loadingStates = loadingStates;
  
  // Continue to next middleware
  next();
});

// Enhanced user authentication middleware with performance optimization and caching
app.use(async (req, res, next) => {
  const token = req.cookies.access_token;
  
  if (!token) {
    res.locals.user = null;
    return next();
  }
  
  try {
    // Check cache first to reduce database lookups
    const cacheKey = `auth_${token}`;
    let user = await cache.get(cacheKey);
    
    if (!user) {
      // Find token in database
      const userToken = await UserToken.findOne({ accessToken: token });
      
      if (!userToken) {
        res.locals.user = null;
        return next();
      }
      
      // Check if token is expired
      if (userToken.expiresAt && userToken.expiresAt < new Date()) {
        logger.info(`Token expired for user ${userToken.userId}`);
        res.clearCookie('access_token');
        res.locals.user = null;
        return next();
      }
      
      // Get user details
      user = await User.findOne({ id: userToken.userId });
      
      // Cache user for future requests (5 minutes)
      if (user) {
        await cache.set(cacheKey, user, 5 * 60 * 1000);
      }
    }
    
    // Set user in res.locals and req for route handlers
    res.locals.user = user || null;
    req.user = user || null; // Also add to req object
    
    // Track user activity
    if (user) {
      // Update last activity asynchronously (don't await to prevent request delays)
      User.updateOne({ id: user.id }, { lastActivity: new Date() })
        .catch(err => logger.error(`Failed to update last activity: ${err.message}`));
      
      // Track active user in metrics
      metrics.increment('users.active');
    }
    
    logger.debug(`User authenticated: ${user?.id}, ${user?.name}`);
  } catch (error) {
    logger.error("Authentication error:", { 
      message: error.message, 
      stack: error.stack 
    });
    metrics.increment('auth.errors');
    res.locals.user = null;
  }
  
  next();
});

// Passport initialization
app.use(passport.initialize());
// Note: Not using passport.session() - app uses custom access_token cookie-based authentication

// Facebook OAuth strategy configuration with improved error handling
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL: CALLBACK_URL,
  profileFields: ['id', 'displayName', 'email', 'picture.type(large)', 'gender', 'birthday', 'location'],
  enableProof: true, // Improves security by verifying request authenticity
  passReqToCallback: true // Pass request to callback for broader context
}, async (req, accessToken, refreshToken, profile, done) => {
  // Track auth attempt
  metrics.increment('auth.facebook_attempts');
  
  try {
    // Calculate token expiration (60 minutes from now)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    
    // Enhance user object with profile data
    const userData = {
      id: profile.id,
      displayName: profile.displayName,
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
      email: profile.emails?.[0]?.value || null,
      picture: profile.photos?.[0]?.value || null,
      gender: profile.gender,
      accessToken,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      authMethod: 'facebook'
    };
    
    // Save/update user token with enhanced metadata
    const userToken = await UserToken.findOneAndUpdate(
      { userId: profile.id },
      { 
        accessToken, 
        expiresAt,
        lastUsed: new Date(),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      },
      { upsert: true, new: true }
    );
    
    // Log successful authentication
    logger.info(`Facebook authentication successful for user ${profile.id}`);
    metrics.increment('auth.facebook_success');
    
    // Notify through socket.io for real-time updates
    if (io) {
      io.to(profile.id).emit('authentication', { success: true });
    }
    
    // Update loading state
    loadingStates.set(profile.id, {
      status: 'authenticated',
      progress: 30,
      message: 'Authentication successful, loading user data...'
    });
    
    return done(null, userData);
  } catch (error) {
    logger.error("Facebook auth error:", { 
      message: error.message, 
      stack: error.stack,
      code: error.code 
    });
    metrics.increment('auth.facebook_errors');
    
    // Update loading state for error
    if (profile?.id) {
      loadingStates.set(profile.id, {
        status: 'error',
        message: 'Authentication failed. Please try again.'
      });
    }
    
    return done(error);
  }
}));

// Authentication routes (including /adminlogin)
app.use('/auth', authLimiter, authRoutes);

// API Routes
app.use('/api', apiLimiter, apiRoutes);

// Admin routes (protected)
app.use('/admin', homeRoute.authenticateToken, adminRoutes);

// Main application routes (catch-all)
// Silence the browser's default favicon request
app.get('/favicon.ico', (req, res) => res.redirect(301, '/img/favicon.ico'));
app.use('/', homeRoute.router);

// Surveillance analysis route
app.use('/surveillance', surveillanceRoutes);
app.use('/internet-search', internetSearchRoutes);


// Enhanced authentication routes
app.get('/auth/facebook', (req, res, next) => {
  // Initialize loading state for this session
  const sessionId = req.sessionID || crypto.randomBytes(16).toString('hex');
  loadingStates.set(sessionId, {
    status: 'authenticating',
    progress: 10,
    message: 'Initiating Facebook authentication...'
  });
  
  // Store the session ID in cookies to retrieve loading state later
  res.cookie('loading_state_id', sessionId, { 
    httpOnly: true,
    maxAge: 10 * 60 * 1000 // 10 minutes
  });
  
  // Log authentication attempt
  logger.info(`Facebook authentication initiated from IP: ${req.ip}`);
  metrics.increment('auth.facebook_initiated');
  
  // Proceed with Facebook authentication
  passport.authenticate('facebook', { 
    scope: ['email', 'user_photos', 'user_posts', 'user_likes'],
    session: false,
    authType: 'rerequest' // Ask user again for permissions they declined previously
  })(req, res, next);
});

/**
 * FACEBOOK AUTH CALLBACK
 */
app.get(
  '/auth/facebook/callback',
  (req, res, next) => {
    console.log('=== FACEBOOK CALLBACK START ===');
    next();
  },
  passport.authenticate('facebook', {
    failureRedirect: '/login?error=Authentication+failed',
    session: false
  }),
  async (req, res) => {
    if (!req.user || !req.user.id) {
      res.clearCookie('loading_state_id');
      metrics.increment('auth.invalid_user');
      return res.redirect('/login?error=Invalid+user+data');
    }

    const userId = req.user.id;
    
    // ✅ CREATE TASK
    const task = taskStatus.create(userId, 'authentication', {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    // ✅ START TASK WITH 6 STEPS
    taskStatus.start(task.id, 6, 'Processing authentication...');

    try {
      // STEP 1 – BASIC PROFILE
      taskStatus.update(task.id, {
        currentStep: 1,
        progress: 16,
        message: 'Fetching profile data...'
      });

      const basicFields = ['id', 'name', 'email', 'picture'];
      const { data: userData } = await axios.get(
        `https://graph.facebook.com/${API_VERSION}/me`,
        {
          params: {
            fields: basicFields.join(','),
            access_token: req.user.accessToken
          },
          timeout: 15000
        }
      );

      // STEP 2 – EXTENDED PROFILE
      taskStatus.update(task.id, {
        currentStep: 2,
        progress: 32,
        message: 'Retrieving additional profile information...'
      });

      try {
        const extendedFields = ['birthday', 'age_range', 'gender', 'location', 'hometown'];
        const { data: extended } = await axios.get(
          `https://graph.facebook.com/${API_VERSION}/me`,
          {
            params: {
              fields: extendedFields.join(','),
              access_token: req.user.accessToken
            },
            timeout: 10000
          }
        );
        Object.assign(userData, extended);
      } catch (err) {
        logger.debug('Extended fields unavailable', { message: err.message });
      }

      // STEP 3 – LIKES
      taskStatus.update(task.id, {
        currentStep: 3,
        progress: 48,
        message: 'Fetching your likes...'
      });

      try {
        const { data } = await axios.get(
          `https://graph.facebook.com/${API_VERSION}/me/likes`,
          {
            params: {
              access_token: req.user.accessToken,
              limit: 100
            },
            timeout: 10000
          }
        );
        userData.likes = data?.data || [];
      } catch {
        userData.likes = [];
      }

      // STEP 4 – DATABASE SAVE
      taskStatus.update(task.id, {
        currentStep: 4,
        progress: 64,
        message: 'Saving user data...'
      });

      let user = await User.findOne({ id: userData.id });

      if (!user) {
        metrics.increment('users.new');
        user = new User({
          id: userData.id,
          name: userData.name,
          email: userData.email || '',
          picture: userData.picture || '',
          birthday: userData.birthday || '',
          age_range: userData.age_range || {},
          gender: userData.gender || '',
          hometown: userData.hometown || {},
          location: userData.location || {},
          likes: userData.likes,
          registrationDate: new Date(),
          lastUpdated: new Date(),
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          authMethod: 'facebook',
          role: 'user',
          status: 'pending',  // ✅ Set to pending for background processing
          analysisComplete: false  // ✅ Mark as not complete
        });
      } else {
        metrics.increment('users.returning');
        Object.assign(user, {
          name: userData.name || user.name,
          email: userData.email || user.email,
          picture: userData.picture || user.picture,
          birthday: userData.birthday || user.birthday,
          age_range: userData.age_range || user.age_range,
          gender: userData.gender || user.gender,
          hometown: userData.hometown || user.hometown,
          location: userData.location || user.location,
          likes: userData.likes || user.likes,
          lastUpdated: new Date(),
          lastLoginDate: new Date(),
          loginCount: (user.loginCount || 0) + 1
        });
      }

      await user.save();

      // STEP 5 - FINALIZING
      taskStatus.update(task.id, {
        currentStep: 5,
        progress: 85,
        message: 'Finalizing login...'
      });

      // Set access token cookie
      res.cookie('access_token', req.user.accessToken, {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000
      });

      // STEP 6 – COMPLETE AUTHENTICATION
      taskStatus.update(task.id, {
        currentStep: 6,
        progress: 95,
        message: 'Login successful! Redirecting...'
      });

      // ✅ COMPLETE THE AUTH TASK
      taskStatus.complete(task.id, { userId: user.id }, 'Authentication complete!');

      // Emit success event
      io.to(user.id).emit('login_complete', { success: true });

      // ✅ CREATE BACKGROUND PROCESSING TASK (so loading page can see it)
      const backgroundTask = taskStatus.create(userId, 'background_analysis', {
        source: 'facebook_callback',
        triggeredAt: new Date()
      });

      // Start the task (marks it as 'running')
      taskStatus.start(backgroundTask.id, 8, 'Starting background analysis...');

      console.log(`🚀 Starting background analysis for user: ${userId}, task: ${backgroundTask.id}`);

      // ✅ START BACKGROUND PROCESSING (non-blocking)
      setImmediate(() => {
        processUserDataInBackground(userId, req.user.accessToken)
          .catch(err => {
            console.error(`❌ Background processing error: ${err.message}`);
            logger.error(`Background processing error: ${err.message}`);
            // Mark task as failed if error occurs
            taskStatus.fail(backgroundTask.id, err, 'Background processing failed');
          });
      });

      // ✅ REDIRECT TO LOADING PAGE
      // Loading page will now see the active task and won't start a duplicate
      res.redirect('/loading');

    } catch (error) {
      // Mark task as failed
      taskStatus.fail(task.id, error, 'Authentication failed');

      logger.error('Authentication error', {
        message: error.message,
        stack: error.stack
      });

      metrics.increment('auth.data_processing_errors');

      res.redirect('/login?error=Failed+to+process+user+data');
    }
  }
);


app.get('/loading', 
  homeRoute.authenticateToken, 
  wrapAsync(async (req, res) => {
    const userId = req.user.id;
    
    // Check if user exists
    const user = await User.findOne({ id: userId });
    
    if (!user) {
      return res.redirect('/login');
    }
    
    // ✅ If already complete, redirect to dashboard immediately
    if (user.analysisComplete || user.status === 'complete') {
      return res.redirect('/');
    }
    
    // ✅ Get the latest task for this user
    const userTasks = taskStatus.getUserTasks(userId);
    const latestTask = userTasks.length > 0 ? userTasks[userTasks.length - 1] : null;
    
    // ✅ Check if there's an ACTIVE task already running
    const hasActiveTask = latestTask && 
      (latestTask.state === 'running' || latestTask.state === 'pending');
    
    // ✅ Only start processing if NO active task exists
    if (!hasActiveTask) {
      // Check if user is stuck in processing for too long
      if (user.status === 'processing') {
        const lastUpdated = user.lastUpdated || new Date();
        const timeSinceUpdate = Date.now() - lastUpdated.getTime();
        
        if (timeSinceUpdate > 10 * 60 * 1000) { // 10 minutes
          console.log(`🔄 User ${userId} stuck in processing, resetting...`);
          user.status = 'pending';
          user.analysisComplete = false;
          await user.save();
          
          // Clear old tasks
          taskStatus.clearUserTasks(userId);
          
          // Start fresh processing
          console.log(`🚀 Starting background processing for stuck user: ${userId}`);
          setImmediate(() => {
            homeRoute.processUserDataInBackground(userId, req.user.accessToken)
              .catch(err => console.error('Restart error:', err));
          });
        }
      } else if (user.status === 'pending' || !user.status) {
        // User needs initial processing
        console.log(`🚀 Starting initial background processing for user: ${userId}`);
        
        const task = taskStatus.create(userId, 'initial_processing', {
          triggeredBy: 'loading_page'
        });
        
        taskStatus.start(task.id, 8, 'Preparing to analyze your data...');
        
        // Start background processing
        setImmediate(() => {
          homeRoute.processUserDataInBackground(userId, req.user.accessToken)
            .catch(err => console.error('Processing error:', err));
        });
      }
    } else {
      console.log(`✅ Active task already exists for user ${userId}, not starting new one`);
    }
    
    res.render('loading', {
      title: 'Loading Your Data',
      userId: userId,
      taskId: latestTask?.id,
      nonce: res.locals.nonce
    });
  })
);

/**
 * AUTH TASK STATUS (SECURE)
 */
app.get('/api/task-status', homeRoute.authenticateToken, (req, res) => {
  const userId = req.user.id;
  const taskId = req.query.taskId;

  if (taskId) {
    const task = taskStatus.get(taskId);
    if (!task || task.userId !== userId) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.json(task);
  }

  const tasks = taskStatus.getUserTasks(userId, { limit: 5 });
  res.json(tasks);
});

// In index.js, find the /task-status route and replace it with:

// In index.js, replace the entire /task-status route with this:

app.get('/task-status', 
  homeRoute.authenticateToken,
  wrapAsync(async (req, res) => {
    const userId = req.user.id;
    
    try {
      // Check user status in database FIRST
      const user = await User.findOne({ id: userId });
      
      // 🔍 DEBUG: Log what we found
      console.log('🔍 /task-status DEBUG:', {
        userId,
        userFound: !!user,
        status: user?.status,
        analysisComplete: user?.analysisComplete,
        lastUpdated: user?.lastUpdated
      });
      
      if (!user) {
        return res.json({
          task: 'User not found',
          progress: 0,
          completed: false,
          error: true
        });
      }
      
      // ✅ CRITICAL FIX: If user is marked as complete, return completed status
      if (user.analysisComplete || user.status === 'complete') {
        console.log('✅ Returning completed status to frontend');
        return res.json({
          task: 'Analysis complete!',
          step: 8,
          progress: 100,
          totalSteps: 8,
          isProcessing: false,
          completed: true,
          redirectTo: '/',
          timestamp: Date.now()
        });
      }
      
      // Check active tasks only if user is not complete
      const userTasks = taskStatus.getUserTasks(userId, { limit: 5 });
      const activeTask = userTasks.find(t => 
        t.state === 'running' || t.state === 'pending'
      );
      const latestTask = userTasks.length > 0 ? userTasks[userTasks.length - 1] : null;
      const task = activeTask || latestTask;
      
      if (task) {
        // If task is already completed, but user not marked complete yet
        if (task.state === 'completed') {
          console.log(`⚠️ Task ${task.id} completed but user not marked complete, marking now`);
          user.status = 'complete';
          user.analysisComplete = true;
          user.lastUpdated = new Date();
          await user.save();
          
          return res.json({
            task: 'Analysis complete!',
            step: 8,
            progress: 100,
            totalSteps: 8,
            isProcessing: false,
            completed: true,
            redirectTo: '/',
            timestamp: Date.now()
          });
        }
        
        return res.json({
          task: task.message || 'Processing...',
          step: task.currentStep || 0,
          progress: task.progress || 0,
          totalSteps: task.totalSteps || 8,
          isProcessing: task.state === 'running',
          completed: task.state === 'completed',
          timestamp: Date.now()
        });
      }
      
      // No active tasks, user not complete - start processing
      res.json({
        task: 'Starting analysis...',
        step: 0,
        progress: 0,
        totalSteps: 8,
        isProcessing: true,
        completed: false,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('❌ Task status error:', error);
      res.json({
        task: 'Error checking status',
        progress: 0,
        completed: false,
        error: true
      });
    }
  })
);

/**
 * BACKGROUND PROCESSING STATUS ENDPOINT
 */
app.get('/api/background-status', homeRoute.authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    try {
        // Check if user needs processing
        const user = await User.findOne({ id: userId });
        
        if (!user) {
            return res.json({
                status: 'error',
                message: 'User not found'
            });
        }
        
        // Check if analysis is complete
        if (user.analysisComplete) {
            return res.json({
                status: 'complete',
                message: 'Analysis complete',
                progress: 100
            });
        }
        
        // Check if analysis is in progress
        const lastUpdated = user.lastUpdated || user.registrationDate;
        const timeSinceUpdate = Date.now() - lastUpdated.getTime();
        
        if (timeSinceUpdate < 30000) { // Within last 30 seconds
            return res.json({
                status: 'processing',
                message: 'Analyzing your data...',
                progress: Math.min(90, Math.floor(timeSinceUpdate / 300)) // 0-90% based on time
            });
        }
        
        // Default: not started
        res.json({
            status: 'pending',
            message: 'Analysis not started',
            progress: 0
        });
    } catch (error) {
        logger.error('Background status error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error checking background status'
        });
    }
});


// Analysis dashboard route
app.get('/analysis', 
  homeRoute.authenticateToken,
  (req, res, next) => {
    // Pass to the homeRoute handler
    require('./routes/homeRoute').router.handle(req, res, next);
  }
);



// Login page with enhanced features
app.get('/login', (req, res) => {
  // Redirect logged in users to dashboard
  if (res.locals.user) {
    return res.redirect('/');
  }
  
  // Get error message from query parameter or flash
  const errorMessage = req.query.error || (req.flash('error').length > 0 ? req.flash('error')[0] : null);
  
  // Get success message from query parameter or flash
  const successMessage = req.query.message || (req.flash('success').length > 0 ? req.flash('success')[0] : null);
  
  // Create a CSRF token for added security
  const csrfToken = crypto.randomBytes(32).toString('hex');
  req.session.csrfToken = csrfToken;
  
  res.render('login', { 
    title: 'Login to VisiSocial',
    user: null,
    error: errorMessage,
    success: successMessage,
    csrfToken,
    nonce: res.locals.nonce 
  });
});


// Admin login page
app.get('/adminlogin', (req, res) => {
  // Redirect logged in users to admin dashboard
  if (res.locals.user) {
    // Note: You'd need to check if they're actually an admin
    return res.redirect('/admin');
  }
  
  // Get error message from query parameter
  const errorMessage = req.query.error || null;
  const successMessage = req.query.message || null;
  
  res.render('admin/adminLogin', { 
    title: 'Admin Login | VisiSocial',
    user: null,
    error: errorMessage,
    success: successMessage,
    nonce: res.locals.nonce 
  });
});

// Admin login POST handler
app.post('/adminlogin', authLimiter, authRoutes);


// Logout route with enhanced security
app.get('/logout', (req, res) => {
  const userId = req.user?.id;
  
  // Clear cookies
  res.clearCookie('access_token');
  res.clearCookie('loading_state_id');
  
  // Invalidate token in database
  if (userId) {
    // Don't await to prevent request delays
    UserToken.updateOne(
      { userId, accessToken: req.cookies.access_token },
      { $set: { isValid: false, revokedAt: new Date() } }
    ).catch(err => logger.error(`Failed to invalidate token: ${err.message}`));
    
    // Emit logout event
    io.to(userId).emit('logout', { success: true });
    
    // Log logout
    logger.info(`User logged out: ${userId}`);
    metrics.increment('auth.logout');
  }
  
  // Clear session
  req.session.destroy((err) => {
    if (err) {
      logger.error(`Session destruction error: ${err.message}`);
    }
    
    // Note: Can't use req.flash() here since session is destroyed
    // Message is passed via query parameter instead
    
    // Redirect to login page
    res.redirect('/login?message=Successfully+logged+out');
  });
});

// Test page
app.get('/test', (req, res) => {
  const error = req.query.error || null;
  const message = req.query.message || "This is a dynamic message from the server!";
  const accessToken = req.cookies.access_token || null;

  // Test all loading states for demonstration
  const demoLoadingStates = {
    authenticating: {
      status: 'authenticating',
      progress: 10,
      message: 'Demo: Initiating Facebook authentication...'
    },
    processing: {
      status: 'processing',
      progress: 30,
      message: 'Demo: Processing authentication...'
    },
    fetching: {
      status: 'fetching_data',
      progress: 50,
      message: 'Demo: Fetching your data from Facebook...'
    },
    analyzing: {
      status: 'analyzing',
      progress: 70,
      message: 'Demo: Analyzing your profile data...'
    },
    complete: {
      status: 'complete',
      progress: 100,
      message: 'Demo: Process complete!'
    },
    error: {
      status: 'error',
      progress: 50,
      message: 'Demo: An error occurred during processing.'
    }
  };

  res.render('test', { 
    error, 
    message, 
    accessToken,
    demoLoadingStates,
    title: 'Test Page',
    nonce: res.locals.nonce,
    serverInfo: {
      version: require('./package.json').version,
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    }
  });
});

// Privacy policy and terms of service
app.get('/privacy', (req, res) => {
  res.render('privacy', {
    title: 'Privacy Policy',
    nonce: res.locals.nonce
  });
});

app.get('/terms', (req, res) => {
  res.render('terms', {
    title: 'Terms of Service',
    nonce: res.locals.nonce
  });
});

// Contact form
app.get('/contact', (req, res) => {
  res.render('contact', {
    title: 'Contact Us',
    nonce: res.locals.nonce,
    csrfToken: crypto.randomBytes(16).toString('hex')
  });
});

app.post('/contact', (req, res) => {
  const { name, email, message, csrfToken } = req.body;
  
  // Simple validation
  if (!name || !email || !message) {
    req.flash('error', 'Please fill in all fields');
    return res.redirect('/contact');
  }
  
  // Log contact submission (in a real app, you'd send an email or save to database)
  logger.info(`Contact form submission from ${email}`);
  
  // Flash success message
  req.flash('success', 'Thank you for your message. We will respond shortly.');
  
  // Redirect back to contact page
  res.redirect('/contact');
});

// Enhanced health check endpoint with detailed system information
app.get('/health', (req, res) => {
  // Get system metrics
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  // Get database status
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  // Check cache availability
  const cacheStatus = cache.isAvailable() ? 'available' : 'unavailable';
  
  // Collect status info
  const statusInfo = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    server: {
      uptime: uptime,
      uptimeFormatted: formatUptime(uptime),
      memory: {
        rss: formatBytes(memoryUsage.rss),
        heapTotal: formatBytes(memoryUsage.heapTotal),
        heapUsed: formatBytes(memoryUsage.heapUsed),
        external: formatBytes(memoryUsage.external)
      },
      version: require('./package.json').version,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV
    },
    database: {
      status: dbStatus,
      connectionCount: mongoose.connections.length
    },
    cache: {
      status: cacheStatus
    },
    requestCount: metrics.getCounter('http.requests') || 0
  };
  
  // If detailed parameter is provided, include more information
  if (req.query.detailed === 'true' && !IS_PRODUCTION) {
    statusInfo.config = {
      port: PORT,
      isProduction: IS_PRODUCTION,
      apiVersion: API_VERSION
    };
    
    statusInfo.metrics = metrics.getAll();
  }
  
  res.status(200).json(statusInfo);
});



// Utility function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  
  return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
}

// Utility function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// File browser for uploaded files (only in development and with authentication)
if (!IS_PRODUCTION) {
  app.use('/uploads', homeRoute.authenticateToken, (req, res, next) => {
    // Only allow users to access their own uploads
    const userPath = path.join(UPLOADS_DIR, req.user.id);
    
    express.static(userPath)(req, res, (err) => {
      if (err) return next(err);
      serveIndex(userPath, { icons: true, view: 'details' })(req, res, next);
    });
  });
}

// Expose metrics endpoint for monitoring in development
if (!IS_PRODUCTION) {
  app.get('/metrics', (req, res) => {
    res.json(metrics.getAll());
  });
  
  // Add route to clear loading states (for development/testing)
  app.get('/clear-loading-states', (req, res) => {
    loadingStates.clear();
    res.redirect('/test');
  });
}

// Progressive Web App manifest
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'VisiSocial - Social Media Analytics',
    short_name: 'VisiSocial',
    description: 'Advanced social media analytics platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#4361ee',
    icons: [
      {
        src: '/img/icon-192.png',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/img/icon-512.png',
        sizes: '512x512',
        type: 'image/png'
      }
    ]
  });
});


// Enhanced debug routes for development and testing

// Add a debug route to check current state
app.get('/debug/task-state', (req, res) => {
  res.json({
    tasks: taskStatus.getAll(),
    loadingStates: loadingStates.getAll(),
    session: req.session,
    timestamp: Date.now()
  });
});

// Add this route for debugging
app.get('/debug/loading-state', (req, res) => {
    const userId = req.user?.id;
    const loadingStateId = req.cookies.loading_state_id;
    const sessionId = req.sessionID;
    
    const data = {
        userId,
        loadingStateId,
        sessionId,
        loadingStates: loadingStates.getAll(),
        tasks: userId ? taskStatus.getUserTasks(userId) : [],
        cookies: req.cookies,
        user: req.user
    };
    
    res.json(data);
});


// Debug route to force complete user processing
app.get('/debug/force-complete', 
  homeRoute.authenticateToken,
  wrapAsync(async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await User.findOne({ id: userId });
      
      if (!user) {
        return res.json({ success: false, message: "User not found" });
      }
      
      // Mark as complete with dummy data
      await user.markAsComplete();
      
      // Clear any stuck tasks
      taskStatus.clearUserTasks(userId);
      
      res.json({ 
        success: true, 
        message: "User marked as complete",
        redirect: "/"
      });
    } catch (error) {
      logger.error(`Debug force complete error: ${error.message}`);
      res.status(500).json({ success: false, message: error.message });
    }
  })
);

// Debug route to check user status
app.get('/debug/user-status', 
  homeRoute.authenticateToken,
  wrapAsync(async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await User.findOne({ id: userId });
      
      if (!user) {
        return res.json({ success: false, message: "User not found" });
      }
      
      // Check if background processing is running
      const tasks = taskStatus.getUserTasks(userId);
      
      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          status: user.status,
          lastUpdated: user.lastUpdated,
          personalityScores: user.personalityScores,
          analysisComplete: user.analysisComplete
        },
        tasks: tasks,
        currentTime: new Date()
      });
    } catch (error) {
      logger.error(`Debug user status error: ${error.message}`);
      res.status(500).json({ success: false, message: error.message });
    }
  })
);

// Debug route to manually trigger background processing
app.get('/debug/start-processing',
  homeRoute.authenticateToken,
  async (req, res) => {
    try {
      console.log('🚀 MANUALLY STARTING BACKGROUND PROCESSING');
      const userId = req.user.id;
      const accessToken = req.user.accessToken;
      
      // Call the background processing function directly
      processUserDataInBackground(userId, accessToken)
        .then(() => {
          console.log('✅ Background processing started manually');
          res.json({ success: true, message: 'Processing started' });
        })
        .catch(err => {
          console.error('❌ Error starting processing:', err);
          res.status(500).json({ success: false, message: err.message });
        });
    } catch (error) {
      console.error('❌ Debug route error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// Fix the debug force-complete route
// Force complete the current user - FIXED VERSION
app.get('/force-complete',
  homeRoute.authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await User.findOne({ id: userId }); // Use the User already imported at top
      
      if (!user) {
        return res.status(404).send('User not found');
      }
      
      console.log(`🔧 Force completing user: ${userId}`);
      console.log(`   Before: status=${user.status}, analysisComplete=${user.analysisComplete}`);
      
      // Mark as complete with dummy data
      user.status = 'complete';
      user.analysisComplete = true;
      user.personalityScores = {
        extroversion: 65,
        neuroticism: 40,
        agreeableness: 70,
        conscientiousness: 60,
        openness: 75,
        confidence: 80
      };
      user.pD = "Your personality analysis shows you're an outgoing and open-minded individual who enjoys social interactions while maintaining emotional stability.";
      user.uD = "Based on your profile, you have diverse interests and engage actively with your social connections.";
      user.areaOfInterest = 'Technology & Social Media';
      user.lastUpdated = new Date();
      
      await user.save();
      
      console.log(`✅ User ${userId} force-completed`);
      console.log(`   After: status=${user.status}, analysisComplete=${user.analysisComplete}`);
      
      res.redirect('/');
      
    } catch (error) {
      console.error('❌ Force complete error:', error);
      res.status(500).send('Error: ' + error.message);
    }
  }
);

// Test the background processing function
app.get('/test-background-processing',
  homeRoute.authenticateToken,
  async (req, res) => {
    try {
      console.log('🧪 Testing processUserDataInBackground...');
      console.log('User ID:', req.user.id);
      console.log('Has accessToken:', !!req.user.accessToken);
      
      // Call the function directly
      await processUserDataInBackground(req.user.id, req.user.accessToken);
      
      res.json({ 
        success: true, 
        message: 'Background processing completed successfully' 
      });
    } catch (error) {
      console.error('❌ Test failed:', error);
      console.error('Stack:', error.stack);
      res.status(500).json({ 
        success: false, 
        message: error.message,
        stack: error.stack 
      });
    }
  }
);

// Debug route to check taskStatus methods
app.get('/debug/task-status-methods',
  homeRoute.authenticateToken,
  (req, res) => {
    try {
      const methods = Object.keys(taskStatus).filter(key => typeof taskStatus[key] === 'function');
      const properties = Object.keys(taskStatus).filter(key => typeof taskStatus[key] !== 'function');
      
      res.json({
        success: true,
        methods,
        properties,
        taskStatus: taskStatus
      });
    } catch (error) {
      console.error('❌ Error checking taskStatus methods:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);


// Serve static files


// Service worker for offline support
app.get('/service-worker.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'js', 'service-worker.js'));
});
app.use(errorLogger);

// Error handling for 404 - Page Not Found
app.all('*', (req, res, next) => {
  // Log the 404 error
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl} from ${req.ip}`);
  metrics.increment('errors.404');
  
  // Check if the request accepts JSON
  if (req.accepts('json') && req.path.startsWith('/api/')) {
    return res.status(404).json({
      status: 'error',
      code: 'NOT_FOUND',
      message: 'The requested endpoint does not exist.'
    });
  }
  
  // Otherwise render the 404 page
  next(new ExpressError('Page not found', 404));
});

// Global error handler with enhanced information and formatting
app.use((err, req, res, next) => {
  // Default status code and message
  const status = err.status || 500;
  const message = err.message || "Something went wrong!";
  
  // Generate unique error ID for tracking
  const errorId = crypto.randomBytes(6).toString('hex').toUpperCase();
  const timestamp = new Date().toISOString();
  const requestId = req.id || req.headers['x-request-id'] || 'N/A';
  
  // Log appropriate errors with enhanced context
  if (status >= 500) {
    logger.error(`[${errorId}] Server error (${status}): ${message}`, {
      errorId,
      status,
      message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      user: req.user?.id,
      referer: req.headers['referer'],
      requestId,
      timestamp,
      // Additional error context
      body: req.body && Object.keys(req.body).length > 0 ? 
            JSON.stringify(req.body).substring(0, 500) : null,
      query: req.query && Object.keys(req.query).length > 0 ? 
             JSON.stringify(req.query).substring(0, 500) : null,
      sessionId: req.session?.id
    });
    metrics.increment('errors.server');
    
    // Alert on critical errors in production
    if (IS_PRODUCTION && status >= 500) {
      metrics.increment(`errors.server.${Math.floor(status / 100)}xx`);
    }
  } else {
    logger.warn(`[${errorId}] Client error (${status}): ${message}`, {
      errorId,
      status,
      message,
      path: req.path,
      method: req.method,
      ip: req.ip,
      user: req.user?.id,
      requestId,
      timestamp
    });
    metrics.increment('errors.client');
    
    // Track specific client error types
    if (status === 404) {
      metrics.increment('errors.not_found');
    } else if (status === 401) {
      metrics.increment('errors.unauthorized');
    } else if (status === 403) {
      metrics.increment('errors.forbidden');
    } else if (status === 400) {
      metrics.increment('errors.bad_request');
    } else if (status === 429) {
      metrics.increment('errors.rate_limit');
    }
  }
  
  // Determine redirect URL based on error type
  let redirectUrl = '/';
  if (status === 401 || status === 403) {
    redirectUrl = '/login?error=' + encodeURIComponent(message);
  } else if (status === 404) {
    redirectUrl = req.session?.returnTo || '/';
  }
  
  // Allow debug mode for detailed error information
  const showDetails = !IS_PRODUCTION || req.query.debug === 'true' || 
                     (req.user && req.user.isAdmin);
  
  // Prepare error details for rendering
  const errorDetails = {
    id: errorId,
    status,
    message,
    code: err.code || getErrorCode(status),
    stack: showDetails ? err.stack : null,
    details: showDetails ? (err.details || null) : null,
    timestamp,
    requestId,
    path: req.path,
    method: req.method,
    // Add user-friendly error type
    type: getErrorType(status),
    suggestions: getErrorSuggestions(status, message)
  };
  
  // Check if the request accepts JSON (API or AJAX requests)
  if (req.accepts('json') && (req.path.startsWith('/api/') || req.xhr || 
      req.headers['accept']?.includes('application/json'))) {
    return res.status(status).json({
      status: 'error',
      error: {
        id: errorId,
        code: errorDetails.code,
        message: formatApiErrorMessage(status, message),
        timestamp,
        requestId,
        // Include details only in debug mode
        ...(showDetails && { details: errorDetails.details })
      },
      links: {
        documentation: 'https://docs.visionsocial.com/errors/' + errorDetails.code,
        support: '/support'
      }
    });
  }
  
  // Render HTML error page
  res.status(status).render('error', { 
    err: errorDetails,
    title: `Error ${status} | VisiSocial`,
    nonce: res.locals.nonce,
    redirectUrl,
    showDetails,
    // Pass environment for conditional rendering
    environment: IS_PRODUCTION ? 'production' : 'development',
    // User info if available
    user: req.user,
    // Include CSRF token for forms if available
    csrfToken: req.csrfToken ? req.csrfToken() : null
  });
});

// Helper function to get error type from status code
function getErrorType(status) {
  const types = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
  };
  return types[status] || 'Error';
}

// Helper function to get error suggestions
function getErrorSuggestions(status, message) {
  const suggestions = {
    400: [
      'Check your input data',
      'Refresh the page and try again',
      'Clear your browser cache'
    ],
    401: [
      'Check your login credentials',
      'Clear browser cookies',
      'Try logging in again'
    ],
    403: [
      'Verify you have permission',
      'Contact your administrator',
      'Check your account status'
    ],
    404: [
      'Check the URL for typos',
      'Navigate back to homepage',
      'Use search to find what you need'
    ],
    429: [
      'Wait a few minutes and try again',
      'Reduce the frequency of requests',
      'Contact support if this persists'
    ],
    500: [
      'Refresh the page in a minute',
      'Clear browser cache and cookies',
      'Try using a different browser'
    ],
    503: [
      'Try again in a few minutes',
      'Check our status page for updates',
      'Contact support if the issue persists'
    ]
  };
  
  // Add message-specific suggestions
  const allSuggestions = suggestions[status] || [
    'Refresh the page',
    'Clear browser cache',
    'Try again in a few minutes',
    'Contact support if the issue persists'
  ];
  
  // Special cases
  if (message.includes('token') || message.includes('session')) {
    allSuggestions.push('Try logging out and back in');
    allSuggestions.push('Clear your browser cookies');
  }
  
  if (message.includes('database') || message.includes('connection')) {
    allSuggestions.push('Check your internet connection');
    allSuggestions.push('Try again when network is stable');
  }
  
  return allSuggestions;
}

// Helper function to get standardized error codes
function getErrorCode(status) {
  const codes = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_SERVER_ERROR',
    502: 'BAD_GATEWAY',
    503: 'SERVICE_UNAVAILABLE',
    504: 'GATEWAY_TIMEOUT'
  };
  return codes[status] || 'UNKNOWN_ERROR';
}

// Helper function to format API error messages
function formatApiErrorMessage(status, message) {
  // For 5xx errors, don't expose internal details in production
  if (IS_PRODUCTION && status >= 500) {
    return 'An internal server error occurred. Please try again later.';
  }
  
  // For 4xx errors, keep the message but clean it up
  if (status >= 400 && status < 500) {
    // Remove technical details from error messages
    const cleanedMessage = message
      .replace(/at .* \(.*\)/g, '') // Remove stack traces
      .replace(/^\s*\n/gm, '') // Remove empty lines
      .trim();
    
    return cleanedMessage || 'Request could not be processed';
  }
  
  return message;
}

// Helper function to check if error is operational (recoverable)
function isOperationalError(err) {
  if (err.isOperational !== undefined) {
    return err.isOperational;
  }
  
  // Consider these as operational (recoverable) errors
  const operationalErrors = [
    'ValidationError',
    'UnauthorizedError',
    'ForbiddenError',
    'NotFoundError',
    'RateLimitError',
    'BadRequestError'
  ];
  
  return operationalErrors.some(errorName => 
    err.name === errorName || err.code === errorName
  );
}

// Export error handling utilities
module.exports = {
  handleError: (err, req, res, next) => {
    // Ensure proper error object
    if (!err.status) {
      err.status = 500;
    }
    
    // Mark as operational if applicable
    if (isOperationalError(err)) {
      err.isOperational = true;
    }
    
    // Pass to the global error handler
    next(err);
  },
  
  // Async error wrapper for routes
  asyncHandler: (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  },
  
  // Custom error classes
  ApiError: class ApiError extends Error {
    constructor(status, message, code, details) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code || getErrorCode(status);
      this.details = details;
      this.isOperational = true;
      Error.captureStackTrace(this, this.constructor);
    }
  },
  
  NotFoundError: class NotFoundError extends Error {
    constructor(message = 'Resource not found') {
      super(message);
      this.name = 'NotFoundError';
      this.status = 404;
      this.code = 'NOT_FOUND';
      this.isOperational = true;
      Error.captureStackTrace(this, this.constructor);
    }
  },
  
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(message = 'Authentication required') {
      super(message);
      this.name = 'UnauthorizedError';
      this.status = 401;
      this.code = 'UNAUTHORIZED';
      this.isOperational = true;
      Error.captureStackTrace(this, this.constructor);
    }
  },
  
  ForbiddenError: class ForbiddenError extends Error {
    constructor(message = 'Access denied') {
      super(message);
      this.name = 'ForbiddenError';
      this.status = 403;
      this.code = 'FORBIDDEN';
      this.isOperational = true;
      Error.captureStackTrace(this, this.constructor);
    }
  },
  
  ValidationError: class ValidationError extends Error {
    constructor(message = 'Validation failed', details) {
      super(message);
      this.name = 'ValidationError';
      this.status = 400;
      this.code = 'VALIDATION_ERROR';
      this.details = details;
      this.isOperational = true;
      Error.captureStackTrace(this, this.constructor);
    }
  },
  
  RateLimitError: class RateLimitError extends Error {
    constructor(message = 'Rate limit exceeded', retryAfter) {
      super(message);
      this.name = 'RateLimitError';
      this.status = 429;
      this.code = 'RATE_LIMITED';
      this.retryAfter = retryAfter;
      this.isOperational = true;
      Error.captureStackTrace(this, this.constructor);
    }
  }
};

// Scheduled tasks
if (IS_PRODUCTION) {
  // Clean up expired tokens daily
  cron.schedule('0 0 * * *', async () => {
    try {
      logger.info('Running scheduled task: Cleaning up expired tokens');
      const result = await UserToken.deleteMany({ expiresAt: { $lt: new Date() } });
      logger.info(`Cleaned up ${result.deletedCount} expired tokens`);
    } catch (error) {
      logger.error('Error cleaning up expired tokens:', error);
    }
  });

  // Clean up temporary files weekly
  cron.schedule('0 0 * * 0', async () => {
    try {
      logger.info('Running scheduled task: Cleaning up temporary files');
      const fs = require('fs').promises;
      
      // Get all files in temp directory
      const files = await fs.readdir(TEMP_DIR);
      let deletedCount = 0;
      
      // Delete files older than 7 days
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      
      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
      
      logger.info(`Cleaned up ${deletedCount} temporary files`);
    } catch (error) {
      logger.error('Error cleaning up temporary files:', error);
    }
  });
  
  // Update metrics hourly
  cron.schedule('0 * * * *', () => {
    logger.info('Running scheduled task: Updating metrics');
    metrics.saveToFile(path.join(__dirname, 'data', 'metrics.json'));
  });
}

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  
  // Create a shutdown timeout to force exit if graceful shutdown fails
  const forcedExitTimeout = setTimeout(() => {
    logger.error('Forced exit due to shutdown timeout');
    process.exit(1);
  }, 30000); // 30 second timeout
  
  // Clean up server connections
  server.close(async () => {
    logger.info('HTTP server closed.');
    
    try {
      // Close database connection (mongoose 6+ returns promise)
      await mongoose.connection.close();
      logger.info('Database connection closed.');
      
      // Close Redis connection if available
      if (cache.redisClient) {
        cache.redisClient.quit();
        logger.info('Redis connection closed.');
      }
      
      // Save metrics before shutdown
      metrics.saveToFile(path.join(__dirname, 'data', 'metrics.json'));
      
      // Clear the timeout and exit gracefully
      clearTimeout(forcedExitTimeout);
      logger.info('Shutdown complete. Exiting process.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', { message: err.message });
      clearTimeout(forcedExitTimeout);
      process.exit(1);
    }
  });
};

// Register shutdown handlers for different signals
['SIGTERM', 'SIGINT', 'SIGUSR2'].forEach(signal => {
  process.on(signal, () => gracefulShutdown(signal));
});

// Handle uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', { 
    message: err?.message || String(err), 
    stack: err?.stack,
    name: err?.name 
  });
  metrics.increment('errors.uncaught_exception');
  
  // Exit with error in production, but stay alive in development
  if (IS_PRODUCTION) {
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', { 
    message: reason?.message || String(reason), 
    stack: reason?.stack,
    name: reason?.name 
  });
  metrics.increment('errors.unhandled_rejection');
  
  // Exit with error in production, but stay alive in development
  if (IS_PRODUCTION) {
    gracefulShutdown('UNHANDLED_REJECTION');
  }
});

// Start server with enhanced logging
server.listen(PORT, () => {
  logger.info('╔════════════════════════════════════════════════════════╗');
  logger.info('║                   VISISOCIAL SERVER                    ║');
  logger.info('╚════════════════════════════════════════════════════════╝');
  logger.info(`✅ Server is running on port ${PORT}`);
  logger.info(`✅ Environment: ${IS_PRODUCTION ? 'Production 🚀' : 'Development 🔧'}`);
  logger.info(`✅ API Version: ${API_VERSION}`);
  logger.info(`✅ Node.js Version: ${process.version}`);
  logger.info(`✅ Server Time: ${new Date().toISOString()}`);
  logger.info(`✅ Visit http://localhost:${PORT}/login to get started`);

  analytics.track('server_start', {
    environment: IS_PRODUCTION ? 'production' : 'development',
    nodeVersion: process.version,
    serverVersion: '2.0.0'
  });
});
