/**
 * Application Configuration
 * Centralized configuration for VisiSocial
 * @version 2.0.0
 */

const path = require('path');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

module.exports = {
  // App Info
  app: {
    name: 'VisiSocial',
    version: '2.0.0',
    description: 'Advanced Social Media Analytics Platform',
    author: 'VisiSocial Team'
  },

  // Server Configuration
  server: {
    port: parseInt(process.env.PORT, 10) || 3001,
    host: process.env.HOST || '0.0.0.0',
    isProduction: IS_PRODUCTION,
    trustProxy: IS_PRODUCTION
  },

  // Security
  security: {
    sessionSecret: process.env.SESSION_SECRET,
    jwtSecret: process.env.JWT_SECRET,
    bcryptRounds: 12,
    corsOrigins: IS_PRODUCTION
      ? [
          'https://visisocial.securecourierservices.com',
          process.env.FRONTEND_URL
        ].filter(Boolean)
      : true,
    allowedOrigins: [
      'https://visisocial.securecourierservices.com',
      'http://localhost:3001',
      'http://localhost:3000'
    ]
  },

  // Database
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/visisocial',
    options: {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    }
  },

  // Redis Cache
  redis: {
    enabled: process.env.REDIS_ENABLED === 'true',
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD,
    prefix: process.env.CACHE_PREFIX || 'visisocial:'
  },

  // Session
  session: {
    name: 'visisocial.sid',
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    secure: IS_PRODUCTION,
    httpOnly: true,
    sameSite: IS_PRODUCTION ? 'strict' : 'lax'
  },

  // Rate Limiting
  rateLimits: {
    general: { windowMs: 15 * 60 * 1000, max: 100 },
    auth: { windowMs: 60 * 60 * 1000, max: 30 },
    api: { windowMs: 15 * 60 * 1000, max: 150 },
    upload: { windowMs: 60 * 60 * 1000, max: 20 },
    export: { windowMs: 60 * 60 * 1000, max: 5 },
    analysis: { windowMs: 60 * 60 * 1000, max: 10 }
  },

  // Facebook OAuth
  facebook: {
    appId: process.env.FACEBOOK_APP_ID,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    apiVersion: process.env.FB_API_VERSION || 'v18.0',
    callbackUrl: IS_PRODUCTION
      ? process.env.PROD_CALLBACK_URL || 'https://visisocial.securecourierservices.com/auth/facebook/callback'
      : process.env.DEV_CALLBACK_URL || 'http://localhost:3001/auth/facebook/callback',
    scope: ['email', 'public_profile', 'user_photos', 'user_posts', 'user_likes'],
    profileFields: ['id', 'displayName', 'email', 'picture.type(large)', 'gender', 'birthday', 'location'],
    graphFields: {
      basic: ['id', 'name', 'email', 'picture'],
      extended: ['birthday', 'age_range', 'gender', 'location', 'hometown'],
      likes: 'likes',
      albums: 'albums',
      feed: 'feed'
    }
  },

  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    orgId: process.env.OPENAI_ORG_ID,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    maxTokens: {
      personality: 800,
      userDescription: 500,
      insights: 800,
      interest: 20
    },
    temperature: {
      analysis: 0.7,
      interest: 0.3
    }
  },

  // File Processing
  files: {
    uploadDir: path.join(process.cwd(), 'uploads'),
    tempDir: path.join(process.cwd(), 'temp'),
    exportDir: path.join(process.cwd(), 'temp', 'exports'),
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    csvPath: path.join(process.cwd(), 'extras', 'mypersonality_final.csv')
  },

  // Image Processing
  images: {
    maxConcurrentOcr: 3,
    maxTotalImages: 25,
    maxDimensions: { width: 1920, height: 1080 },
    jpegQuality: 80,
    ocrLanguage: 'eng'
  },

  // Analysis Settings
  analysis: {
    minWordOccurrences: 2,
    similarityThreshold: 0.15,
    maxTopWords: 15,
    personalityDefaults: {
      extroversion: 50,
      neuroticism: 50,
      agreeableness: 50,
      conscientiousness: 50,
      openness: 50,
      confidence: 0
    }
  },

  // Cache TTLs (in milliseconds)
  cacheTTL: {
    default: 60 * 60 * 1000, // 1 hour
    csv: 60 * 60 * 1000, // 1 hour
    personality: 7 * 24 * 60 * 60 * 1000, // 7 days
    userDescription: 7 * 24 * 60 * 60 * 1000, // 7 days
    insights: 7 * 24 * 60 * 60 * 1000, // 7 days
    auth: 5 * 60 * 1000, // 5 minutes
    aboutPage: 60 * 60 * 1000 // 1 hour
  },

  // Timeouts
  timeouts: {
    fetch: 15000,
    ocr: 30000,
    openai: 60000,
    database: 10000
  },

  // Retry Settings
  retry: {
    maxAttempts: 3,
    backoffDelay: 1000,
    maxBackoff: 10000
  },

  // Logging
  logging: {
    level: IS_PRODUCTION ? 'info' : 'debug',
    format: IS_PRODUCTION ? 'combined' : 'dev',
    maxFiles: 5,
    maxSize: '10m'
  },

  // Feature Flags
  features: {
    imageOcr: true,
    personalityAnalysis: true,
    sentimentAnalysis: true,
    dataExport: true,
    realTimeUpdates: true,
    adminDashboard: true
  },

  // Admin Settings
  admin: {
    emails: (process.env.ADMIN_EMAILS || '').split(',').filter(Boolean),
    defaultRole: 'user',
    roles: ['user', 'moderator', 'admin', 'superadmin']
  },

  // Scheduled Jobs
  jobs: {
    tokenCleanup: '0 0 * * *', // Daily at midnight
    tempFileCleanup: '0 0 * * 0', // Weekly on Sunday
    metricsSnapshot: '0 * * * *', // Hourly
    cacheCleanup: '*/30 * * * *' // Every 30 minutes
  }
};