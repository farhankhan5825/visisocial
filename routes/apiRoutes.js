/**
 * API Routes
 * RESTful API endpoints for data access and analytics
 * @version 2.0.0
 */

// roues/apiRoutes.js

const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');

const User = require('../models/User');
const UserToken = require('../models/UserToken');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const analytics = require('../utils/analytics');
const cache = require('../utils/cache');
const taskStatus = require('../utils/taskStatus');
const config = require('../config/appConfig');
const wrapAsync = require('../utils/wrapAsync');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
// Import analysis functions from homeRoute for reuse
const { calculatePersonalityScoresFromCSV } = require('./homeRoute');

/**
 * Middleware: Require authentication
 */
const requireAuth = (req, res, next) => {
  if (!res.locals.user) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Authentication required'
    });
  }
  req.user = res.locals.user;
  next();
};

/**
 * Middleware: Track API calls
 */
const trackApiCall = (req, res, next) => {
  const start = Date.now();
  metrics.increment('api.calls.total');
  metrics.increment(`api.calls.${req.method.toLowerCase()}`);

  res.on('finish', () => {
    const duration = Date.now() - start;
    metrics.timing('api.response_time', duration, {
      method: req.method,
      path: req.route?.path || req.path,
      status: res.statusCode
    });

    if (res.statusCode >= 400) {
      metrics.increment('api.errors');
    }
  });

  next();
};

router.use(trackApiCall);

// ==================== Health & Status ====================

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = dbState === 1 ? 'connected' : 'disconnected';

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbStatus,
    version: config.app.version
  });
});

/**
 * GET /api/status
 * Detailed status endpoint
 */
router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    app: {
      name: config.app.name,
      version: config.app.version
    },
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version
    },
    database: {
      status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    },
    cache: {
      available: cache.isAvailable()
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== User Profile ====================

/**
 * GET /api/profile
 * Get current user profile
 */
router.get('/profile', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;

  // Try cache first
  const cacheKey = `api_profile_${userId}`;
  let user = await cache.get(cacheKey);

  if (!user) {
    user = await User.findOne({ id: userId });
    if (user) {
      await cache.set(cacheKey, user, config.cacheTTL.auth);
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
      birthday: user.birthday,
      location: user.location?.name,
      hometown: user.hometown?.name,
      languages: user.languages,
      createdAt: user.createdAt,
      lastUpdated: user.lastUpdated
    }
  });
}));

/**
 * PUT /api/profile
 * Update user profile
 */
router.put('/profile', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;
  const { displayName, preferences } = req.body;

  const updateFields = {};
  if (displayName) updateFields.displayName = displayName;
  if (preferences) updateFields.preferences = preferences;

  const user = await User.findOneAndUpdate(
    { id: userId },
    { $set: updateFields },
    { new: true }
  );

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }

  // Clear cache
  await cache.del(`api_profile_${userId}`);
  await cache.del(`user_profile_${userId}`);

  analytics.track('profile_updated', { userId });

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      displayName: user.displayName,
      preferences: user.preferences
    }
  });
}));

// ==================== Personality Analysis ====================

/**
 * GET /api/analysis/personality
 * Get personality analysis results
 */
router.get('/analysis/personality', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;

  const user = await User.findOne({ id: userId });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }

  res.json({
    success: true,
    personality: {
      scores: user.personalityScores || config.analysis.personalityDefaults,
      description: user.pD || null,
      lastUpdated: user.lastUpdated
    }
  });
}));

/**
 * POST /api/analysis/personality/refresh
 * Trigger personality analysis refresh
 */
router.post('/analysis/personality/refresh', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;

  const user = await User.findOne({ id: userId });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }

  // Create task for tracking
  const task = taskStatus.create(userId, 'personality_analysis', {
    source: 'api_refresh'
  });

  taskStatus.start(task.id, 3, 'Starting personality analysis...');

  // Run analysis asynchronously
  setImmediate(async () => {
    try {
      taskStatus.increment(task.id, 'Analyzing text data...');

      const feedText = user.feedData
        .map(item => typeof item === 'string' ? item : (item.message || item.text || ''))
        .join(' ');

      const personalityScores = await calculatePersonalityScoresFromCSV(feedText);

      taskStatus.increment(task.id, 'Updating profile...');

      user.personalityScores = personalityScores;
      user.lastUpdated = new Date();
      await user.save();

      // Clear caches
      await cache.clearPrefix(`user_${userId}`);
      await cache.clearPrefix(`personality_${userId}`);

      taskStatus.complete(task.id, { scores: personalityScores });
      analytics.track('personality_refreshed', { userId });

    } catch (error) {
      logger.error('Personality refresh error', { userId, error: error.message });
      taskStatus.fail(task.id, error);
    }
  });

  res.json({
    success: true,
    taskId: task.id,
    message: 'Analysis started'
  });
}));

/**
 * GET /api/analysis/sentiment
 * Get sentiment analysis results
 */
router.get('/analysis/sentiment', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;

  const user = await User.findOne({ id: userId });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }

  res.json({
    success: true,
    sentiment: user.sentimentResult || { score: 50, comparative: 0 },
    lastUpdated: user.lastUpdated
  });
}));


// Clear analysis data
router.post('/analysis/clear', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;
  
  const user = await User.findOne({ id: userId });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }
  
  // Clear analysis data but keep basic profile
  user.feedData = [];
  user.albumsData = [];
  user.processedAlbums = [];
  user.mostCommonWords = [];
  user.personalityScores = {
    extroversion: 50,
    neuroticism: 50,
    agreeableness: 50,
    conscientiousness: 50,
    openness: 50,
    confidence: 0
  };
  user.sentimentResult = { score: 50, comparative: 0 };
  user.pD = '';
  user.uD = '';
  user.areaOfInterest = '';
  user.lastUpdated = new Date();
  
  await user.save();
  
  // Clear cache
  await cache.clearPrefix(`user_${userId}`);
  await cache.clearPrefix(`analysis_${userId}`);
  
  analytics.track('analysis_cleared', { userId });
  logger.info(`Analysis data cleared for user: ${userId}`);
  
  res.json({
    success: true,
    message: 'Analysis data cleared successfully'
  });
}));


/**
 * GET /api/analysis/interests
 * Get interest analysis
 */
router.get('/analysis/interests', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;

  const user = await User.findOne({ id: userId });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }

  res.json({
    success: true,
    interests: {
      primary: user.areaOfInterest,
      categories: user.mostCommonLikes,
      diversity: user.interestDiversity,
      likes: user.likes?.slice(0, 20) || []
    }
  });
}));

/**
 * GET /api/analysis/insights
 * Get AI-generated insights
 */
router.get('/analysis/insights', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;

  // Check cache
  const cacheKey = `insights_${userId}`;
  let insights = await cache.get(cacheKey);

  if (!insights) {
    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND'
      });
    }

    // Generate basic insights from available data
    insights = {
      personality: [],
      recommendations: [],
      trends: []
    };

    // Add personality insights
    if (user.personalityScores) {
      const { extroversion, openness, conscientiousness } = user.personalityScores;

      if (extroversion > 70) {
        insights.personality.push({
          title: 'Social Energy',
          description: 'You draw energy from social interactions and tend to be outgoing.'
        });
      }
      if (openness > 70) {
        insights.personality.push({
          title: 'Creative Mind',
          description: 'You have a strong appreciation for art, creativity, and new experiences.'
        });
      }
      if (conscientiousness > 70) {
        insights.personality.push({
          title: 'Goal-Oriented',
          description: 'You tend to be organized, dependable, and achievement-focused.'
        });
      }
    }

    // Add recommendations
    if (user.areaOfInterest) {
      insights.recommendations.push({
        title: `Explore ${user.areaOfInterest}`,
        description: `Based on your interests, you might enjoy exploring more about ${user.areaOfInterest}.`
      });
    }

    await cache.set(cacheKey, insights, config.cacheTTL.insights);
  }

  res.json({
    success: true,
    insights
  });
}));

// ==================== Data & Statistics ====================

/**
 * GET /api/stats
 * Get user statistics
 */
router.get('/stats', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;

  const user = await User.findOne({ id: userId });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }

  res.json({
    success: true,
    stats: {
      feedItems: user.feedData?.length || 0,
      likes: user.likes?.length || 0,
      albums: user.albumsData?.length || 0,
      engagementScore: user.engagementScore || 0,
      vocabularyDiversity: user.textStatistics?.vocabularyDiversity || 0,
      totalWords: user.textStatistics?.totalWords || 0,
      memberSince: user.createdAt
    }
  });
}));

/**
 * GET /api/words
 * Get word frequency data
 */
router.get('/words', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;
  const limit = parseInt(req.query.limit) || 15;

  const user = await User.findOne({ id: userId });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }

  res.json({
    success: true,
    words: (user.mostCommonWords || []).slice(0, limit),
    statistics: user.textStatistics
  });
}));

// ==================== Tasks ====================

/**
 * GET /api/tasks
 * Get user's tasks
 */
router.get('/tasks', requireAuth, (req, res) => {
  const userId = req.user.id;
  const state = req.query.state;

  const tasks = taskStatus.getUserTasks(userId, { state, limit: 20 });

  res.json({
    success: true,
    tasks
  });
});

/**
 * GET /api/tasks/:id
 * Get specific task status
 */
router.get('/tasks/:id', requireAuth, (req, res) => {
  const task = taskStatus.get(req.params.id);

  if (!task) {
    return res.status(404).json({
      success: false,
      error: 'TASK_NOT_FOUND'
    });
  }

  // Verify ownership
  if (task.userId !== req.user.id) {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN'
    });
  }

  res.json({
    success: true,
    task
  });
});

/**
 * POST /api/tasks/:id/cancel
 * Cancel a task
 */
router.post('/tasks/:id/cancel', requireAuth, (req, res) => {
  const task = taskStatus.get(req.params.id);

  if (!task) {
    return res.status(404).json({
      success: false,
      error: 'TASK_NOT_FOUND'
    });
  }

  if (task.userId !== req.user.id) {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN'
    });
  }

  const cancelled = taskStatus.cancel(req.params.id);

  res.json({
    success: !!cancelled,
    task: cancelled
  });
});

// ==================== Analytics ====================

/**
 * GET /api/analytics/events
 * Get analytics events (admin or own)
 */
router.get('/analytics/events', requireAuth, (req, res) => {
  const userId = req.user.id;
  const limit = parseInt(req.query.limit) || 50;

  const events = analytics.getEvents({
    userId,
    limit
  });

  res.json({
    success: true,
    events
  });
});

/**
 * GET /api/analytics/summary
 * Get analytics summary
 */
router.get('/analytics/summary', requireAuth, (req, res) => {
  const userId = req.user.id;

  const userStats = analytics.getUserStats(userId);

  res.json({
    success: true,
    summary: userStats
  });
});

// ==================== Facebook Data ====================

/**
 * GET /api/facebook/profile
 * Get Facebook profile data
 */
router.get('/facebook/profile', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;

  // Get token
  const userToken = await UserToken.findOne({ userId, isValid: true });
  if (!userToken) {
    return res.status(401).json({
      success: false,
      error: 'NO_VALID_TOKEN',
      message: 'No valid Facebook token found'
    });
  }

  try {
    const response = await axios.get(`https://graph.facebook.com/${config.facebook.apiVersion}/me`, {
      params: {
        fields: config.facebook.graphFields.basic.join(','),
        access_token: userToken.accessToken
      },
      timeout: config.timeouts.fetch
    });

    res.json({
      success: true,
      profile: response.data
    });
  } catch (error) {
    logger.error('Facebook API error', { error: error.message });

    if (error.response?.status === 401) {
      return res.status(401).json({
        success: false,
        error: 'TOKEN_EXPIRED',
        message: 'Facebook token has expired'
      });
    }

    res.status(500).json({
      success: false,
      error: 'FACEBOOK_API_ERROR',
      message: 'Failed to fetch Facebook data'
    });
  }
}));



router.get('/analysis/dashboard', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;
  
  const user = await User.findOne({ id: userId });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }
  
  // Get or generate insights
  let insights = [];
  let recommendations = [];
  
  // Check cache for insights
  const cacheKeyInsights = `insights_${userId}`;
  const cacheKeyRecs = `recommendations_${userId}`;
  
  const cachedInsights = await cache.get(cacheKeyInsights);
  const cachedRecs = await cache.get(cacheKeyRecs);
  
  if (cachedInsights && cachedRecs) {
    insights = cachedInsights;
    recommendations = cachedRecs;
  } else {
    // Import the function from homeRoute
    const { generateUserInsights } = require('./homeRoute');
    try {
      const userInsights = await generateUserInsights(user);
      insights = userInsights.insights;
      recommendations = userInsights.recommendations;
      
      // Cache for 24 hours
      await cache.set(cacheKeyInsights, insights, 24 * 60 * 60 * 1000);
      await cache.set(cacheKeyRecs, recommendations, 24 * 60 * 60 * 1000);
    } catch (error) {
      logger.warn(`Insights generation failed: ${error.message}`);
      // Fallback insights
      insights = [{ 
        title: 'Data Analysis Complete', 
        description: 'Your social media patterns have been analyzed.' 
      }];
      recommendations = [{ 
        title: 'Explore More Features', 
        description: 'Complete your profile to get more personalized recommendations.' 
      }];
    }
  }
  
  res.json({
    success: true,
    analysis: {
      personalityScores: user.personalityScores || {
        extroversion: 50,
        neuroticism: 50,
        agreeableness: 50,
        conscientiousness: 50,
        openness: 50,
        confidence: 0
      },
      sentiment: user.sentimentResult || { score: 50, comparative: 0 },
      mostCommonWords: user.mostCommonWords || [],
      mostCommonLikes: user.mostCommonLikes || {},
      areaOfInterest: user.areaOfInterest || 'General',
      personalityDescription: user.pD || '',
      insights,
      recommendations,
      textStatistics: user.textStatistics || {
        totalWords: 0,
        uniqueWords: 0,
        vocabularyDiversity: 0,
        sentences: 0,
        characters: 0
      },
      readability: user.readability || {
        fleschKincaid: 50,
        syllablesPerWord: 0,
        wordsPerSentence: 0
      },
      lastUpdated: user.lastUpdated
    }
  });
}));


// ==================== Export ====================

/**
 * GET /api/export/json
 * Export user data as JSON
 */
router.get('/export/json', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;

  const user = await User.findOne({ id: userId }).lean();
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }

  // Remove sensitive fields
  delete user._id;
  delete user.__v;

  analytics.track('data_exported', { userId, format: 'json' });
  metrics.increment('exports.json');

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=visisocial-export-${userId}.json`);
  res.json(user);
}));

// ==================== PDF Export ====================
// ==================== PDF Export ====================
router.get('/export/pdf', requireAuth, wrapAsync(async (req, res) => {
  const userId = req.user.id;
  
  const user = await User.findOne({ id: userId });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'USER_NOT_FOUND'
    });
  }
  
  try {
    // Generate HTML for PDF - SIMPLIFIED VERSION
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>VisiSocial Analysis Report - ${user.name}</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            padding: 40px; 
            line-height: 1.6;
            color: #333;
          }
          .header { 
            text-align: center; 
            margin-bottom: 40px; 
            padding-bottom: 20px; 
            border-bottom: 2px solid #333; 
          }
          .header h1 { color: #4a6cf7; }
          .section { margin-bottom: 30px; }
          .section-title { 
            font-size: 18px; 
            font-weight: bold; 
            color: #333; 
            margin-bottom: 15px; 
            padding-bottom: 5px; 
            border-bottom: 1px solid #ccc; 
          }
          .personality-grid { 
            display: grid; 
            grid-template-columns: repeat(2, 1fr); 
            gap: 20px; 
          }
          .trait-item { 
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 15px; 
          }
          .trait-name { 
            font-weight: bold; 
            color: #555; 
            margin-bottom: 5px;
          }
          .trait-value { 
            color: #333; 
            font-size: 24px;
            font-weight: bold;
          }
          .trait-bar {
            height: 10px;
            background: #e9ecef;
            border-radius: 5px;
            margin-top: 10px;
            overflow: hidden;
          }
          .trait-fill {
            height: 100%;
            background: #4a6cf7;
            border-radius: 5px;
          }
          .insight-item, .recommendation-item { 
            margin-bottom: 15px; 
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #4a6cf7;
          }
          .footer { 
            margin-top: 50px; 
            text-align: center; 
            color: #666; 
            font-size: 12px; 
            padding-top: 20px;
            border-top: 1px solid #ddd;
          }
          .stat-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin: 20px 0;
          }
          .stat-box {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
          }
          .stat-value {
            font-size: 28px;
            font-weight: bold;
            color: #4a6cf7;
          }
          .stat-label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>VisiSocial Personality Analysis Report</h1>
          <h2>${user.name}</h2>
          <p>Generated on ${new Date().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}</p>
        </div>
        
        <div class="section">
          <h3 class="section-title">Personality Profile</h3>
          <div class="personality-grid">
            <div class="trait-item">
              <div class="trait-name">Openness</div>
              <div class="trait-value">${user.personalityScores?.openness || 50}%</div>
              <div class="trait-bar">
                <div class="trait-fill" style="width: ${user.personalityScores?.openness || 50}%"></div>
              </div>
            </div>
            <div class="trait-item">
              <div class="trait-name">Conscientiousness</div>
              <div class="trait-value">${user.personalityScores?.conscientiousness || 50}%</div>
              <div class="trait-bar">
                <div class="trait-fill" style="width: ${user.personalityScores?.conscientiousness || 50}%"></div>
              </div>
            </div>
            <div class="trait-item">
              <div class="trait-name">Extroversion</div>
              <div class="trait-value">${user.personalityScores?.extroversion || 50}%</div>
              <div class="trait-bar">
                <div class="trait-fill" style="width: ${user.personalityScores?.extroversion || 50}%"></div>
              </div>
            </div>
            <div class="trait-item">
              <div class="trait-name">Agreeableness</div>
              <div class="trait-value">${user.personalityScores?.agreeableness || 50}%</div>
              <div class="trait-bar">
                <div class="trait-fill" style="width: ${user.personalityScores?.agreeableness || 50}%"></div>
              </div>
            </div>
            <div class="trait-item">
              <div class="trait-name">Neuroticism</div>
              <div class="trait-value">${user.personalityScores?.neuroticism || 50}%</div>
              <div class="trait-bar">
                <div class="trait-fill" style="width: ${user.personalityScores?.neuroticism || 50}%"></div>
              </div>
            </div>
          </div>
        </div>
        
        ${user.pD ? `
        <div class="section">
          <h3 class="section-title">Personality Description</h3>
          <p style="text-align: justify;">${user.pD.replace(/\n/g, '<br>')}</p>
        </div>
        ` : ''}
        
        <div class="section">
          <h3 class="section-title">Statistics</h3>
          <div class="stat-grid">
            <div class="stat-box">
              <div class="stat-value">${user.sentimentResult?.score || 50}</div>
              <div class="stat-label">Sentiment Score</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">${user.engagementScore || 0}</div>
              <div class="stat-label">Engagement</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">${user.textStatistics?.totalWords || 0}</div>
              <div class="stat-label">Words Analyzed</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">${user.textStatistics?.uniqueWords || 0}</div>
              <div class="stat-label">Unique Words</div>
            </div>
          </div>
        </div>
        
        ${user.areaOfInterest ? `
        <div class="section">
          <h3 class="section-title">Primary Interest Area</h3>
          <p><strong>${user.areaOfInterest}</strong></p>
        </div>
        ` : ''}
        
        <div class="footer">
          <p>Report generated by VisiSocial - Social Media Analytics Platform</p>
          <p>Confidential - For personal use only</p>
          <p>User ID: ${user.id} • Report ID: ${Date.now()}</p>
        </div>
      </body>
      </html>
    `;
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const timestamp = Date.now();
    const pdfPath = path.join(tempDir, `report-${userId}-${timestamp}.pdf`);
    
    // Launch Puppeteer and generate PDF
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      
      // Set content directly (no external files needed)
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '40px',
          right: '40px',
          bottom: '40px',
          left: '40px'
        }
      });
      
      await browser.close();
      
      // Send PDF as response
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=visisocial-report-${user.id}-${timestamp}.pdf`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      // Stream file
      const pdfStream = fs.createReadStream(pdfPath);
      pdfStream.pipe(res);
      
      // Clean up file after sending
      pdfStream.on('end', () => {
        fs.unlink(pdfPath, (err) => {
          if (err) logger.error(`Error deleting PDF file: ${err.message}`);
        });
      });
      
      pdfStream.on('error', (err) => {
        logger.error(`PDF stream error: ${err.message}`);
        if (!res.headersSent) {
          res.status(500).json({ 
            success: false, 
            message: "Error streaming PDF file" 
          });
        }
      });
      
    } catch (pdfError) {
      await browser.close();
      throw pdfError;
    }
    
  } catch (error) {
    logger.error('PDF export error:', error);
    
    // Send JSON response instead of trying to fallback to JSON file
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        error: 'PDF_EXPORT_ERROR',
        message: 'Failed to generate PDF report. Please try again later.'
      });
    }
  }
}));

// ==================== Error Handler ====================

router.use((err, req, res, next) => {
  logger.error('API error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  metrics.increment('api.errors');

  res.status(err.status || 500).json({
    success: false,
    error: err.code || 'API_ERROR',
    message: config.server.isProduction
      ? 'An error occurred'
      : err.message
  });
});

module.exports = router;