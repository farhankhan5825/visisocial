/**
 * Admin Routes /routes/adminRoutes.js
 * Comprehensive administration dashboard with advanced features
 * @version 5.0.1 - Fixed cache methods and error handling
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv');
const archiver = require('archiver');

const Admin = require('../models/Admin');
const User = require('../models/User');
const UserToken = require('../models/UserToken');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const analytics = require('../utils/analytics');
const cache = require('../utils/cache');
const config = require('../config/appConfig');
const wrapAsync = require('../utils/wrapAsync');

// ======================================================
// 🔑 Admin authentication middleware using access token
// ======================================================
const requireAdmin = wrapAsync(async (req, res, next) => {
  const token = req.cookies?.access_token;

  if (!token) {
    if (req.accepts('html')) {
      req.flash('error', 'Please log in to access admin area');
      return res.redirect('/adminlogin');
    }
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }

  const userToken = await UserToken.findOne({ accessToken: token, isValid: true });
  if (!userToken || new Date(userToken.expiresAt) < new Date()) {
    if (req.accepts('html')) return res.redirect('/adminlogin?error=Session+expired');
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }

  const admin = await Admin.findOne({ id: userToken.userId });
  if (!admin) {
    metrics.increment('auth.admin_unauthorized');
    if (req.accepts('html')) return res.redirect('/adminlogin?error=Unauthorized');
    return res.status(403).json({ success: false, error: 'FORBIDDEN' });
  }

  req.adminUser = admin;
  metrics.increment('auth.admin_session_active');
  logger.debug(`Admin ${admin.id} authenticated successfully`);

  next();
});

// Apply admin authentication to all routes
router.use(requireAdmin);

// ======================================================
// 🛠️ SAFE CACHE HELPERS
// ======================================================
const getCacheStats = async () => {
  try {
    // Get cache size if method exists
    let size = 0;
    if (typeof cache.sizeKB === 'function') {
      size = await cache.sizeKB();
    } else if (typeof cache.size === 'function') {
      size = await cache.size();
    }

    // Get cache item count if method exists
    let items = 0;
    if (typeof cache.countItems === 'function') {
      items = await cache.countItems();
    } else if (typeof cache.count === 'function') {
      items = await cache.count();
    } else if (typeof cache.keys === 'function') {
      const keys = await cache.keys();
      items = keys.length;
    }

    // Calculate hit rate if methods exist
    let hitRate = 0;
    if (typeof cache.getHitRate === 'function') {
      hitRate = await cache.getHitRate();
    } else if (typeof cache.stats === 'function') {
      const stats = await cache.stats();
      hitRate = stats.hitRate || 0;
    }

    return { size, items, hitRate };
  } catch (error) {
    logger.warn('Error getting cache stats', { error: error.message });
    return { size: 0, items: 0, hitRate: 0 };
  }
};

// ======================================================
// 📊 DASHBOARD ROOT - Enhanced with comprehensive stats
// ======================================================
router.get('/', wrapAsync(async (req, res) => {
  const now = new Date();
  const todayStart = new Date(now.setHours(0, 0, 0, 0));
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // User statistics
  const [
    totalUsers, 
    newUsersToday, 
    newUsersWeek, 
    newUsersMonth,
    activeUsersWeek,
    activeUsersMonth
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: todayStart } }),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    User.countDocuments({ createdAt: { $gte: monthAgo } }),
    User.countDocuments({ lastUpdated: { $gte: weekAgo } }),
    User.countDocuments({ lastUpdated: { $gte: monthAgo } })
  ]);

  // Token statistics
  const [activeTokens, expiredTokens] = await Promise.all([
    UserToken.countDocuments({ isValid: true, expiresAt: { $gt: new Date() } }),
    UserToken.countDocuments({ isValid: false })
  ]);

  // Recent users with more details
  const recentUsers = await User.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .select('id name email picture createdAt lastUpdated personalityScores engagementScore');

  // System statistics
  const memoryUsage = process.memoryUsage();
  const cpus = os.cpus();
  const cpuLoad = Math.round(cpus.reduce((acc, cpu) => {
    const total = Object.values(cpu.times).reduce((t, v) => t + v, 0);
    return acc + (1 - cpu.times.idle / total);
  }, 0) / cpus.length * 100);

  // Calculate growth rates
  const weeklyGrowthRate = newUsersWeek > 0 ? 
    Math.round(((newUsersWeek - newUsersToday * 7) / (newUsersWeek || 1)) * 100) : 0;
  
  const monthlyGrowthRate = newUsersMonth > 0 ?
    Math.round(((newUsersMonth - newUsersWeek * 4) / (newUsersMonth || 1)) * 100) : 0;

  // Cache statistics - SAFE
  const cacheStats = await getCacheStats();

  // Database statistics
  const dbStats = await mongoose.connection.db.stats();
  
  // Calculate engagement metrics
  const avgEngagement = await User.aggregate([
    { $match: { engagementScore: { $exists: true, $ne: null } } },
    { $group: { _id: null, avgScore: { $avg: '$engagementScore' } } }
  ]);

  // Get top personalities distribution
  const personalityDistribution = await User.aggregate([
    { $match: { personalityScores: { $exists: true } } },
    {
      $project: {
        dominantTrait: {
          $arrayElemAt: [
            ['Openness', 'Conscientiousness', 'Extroversion', 'Agreeableness', 'Neuroticism'],
            {
              $indexOfArray: [
                [
                  '$personalityScores.openness',
                  '$personalityScores.conscientiousness',
                  '$personalityScores.extroversion',
                  '$personalityScores.agreeableness',
                  '$personalityScores.neuroticism'
                ],
                { $max: [
                  '$personalityScores.openness',
                  '$personalityScores.conscientiousness',
                  '$personalityScores.extroversion',
                  '$personalityScores.agreeableness',
                  '$personalityScores.neuroticism'
                ]}
              ]
            }
          ]
        }
      }
    },
    { $group: { _id: '$dominantTrait', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  // Safe stats object for template
  const safeStats = {
    users: {
      total: totalUsers || 0,
      newToday: newUsersToday || 0,
      newWeek: newUsersWeek || 0,
      newMonth: newUsersMonth || 0,
      activeWeek: activeUsersWeek || 0,
      activeMonth: activeUsersMonth || 0,
      weeklyGrowth: weeklyGrowthRate,
      monthlyGrowth: monthlyGrowthRate,
      avgEngagement: avgEngagement[0]?.avgScore || 0
    },
    tokens: {
      active: activeTokens || 0,
      expired: expiredTokens || 0,
      total: (activeTokens || 0) + (expiredTokens || 0)
    },
    system: {
      cpuLoad,
      memoryUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      memoryTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      memoryPercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      requests: metrics.getCounter('api.calls') || 0,
      errors: metrics.getCounter('errors') || 0
    },
    database: {
      size: Math.round(dbStats.dataSize / 1024 / 1024),
      collections: dbStats.collections || 0,
      indexes: dbStats.indexes || 0,
      avgObjSize: Math.round(dbStats.avgObjSize || 0)
    },
    cache: cacheStats,
    personality: personalityDistribution,
    tasks: {
      count: 0,
      running: 0
    }
  };

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    stats: safeStats,
    recentUsers,
    admin: req.adminUser,
    analytics: analytics.getWeeklyStats ? analytics.getWeeklyStats() : {},
    nonce: res.locals.nonce
  });
}));

// ======================================================
// 📈 ENHANCED STATS ENDPOINT
// ======================================================
router.get('/stats', wrapAsync(async (req, res) => {
  const now = new Date();
  const todayStart = new Date(now.setHours(0, 0, 0, 0));
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalUsers, newUsersToday, newUsersWeek, activeTokens] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: todayStart } }),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    UserToken.countDocuments({ isValid: true, expiresAt: { $gt: new Date() } })
  ]);

  // Get hourly signup distribution for today
  const hourlySignups = await User.aggregate([
    { $match: { createdAt: { $gte: todayStart } } },
    {
      $group: {
        _id: { $hour: '$createdAt' },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  res.json({
    success: true,
    stats: {
      users: { 
        total: totalUsers, 
        newToday: newUsersToday,
        newWeek: newUsersWeek,
        hourlyDistribution: hourlySignups
      },
      activeTokens,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: Date.now()
    }
  });
}));

// ======================================================
// 📊 ANALYTICS DASHBOARD
// ======================================================
router.get('/analytics', wrapAsync(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // User growth over time
  const userGrowth = await User.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  // Engagement distribution
  const engagementDistribution = await User.aggregate([
    { $match: { engagementScore: { $exists: true } } },
    {
      $bucket: {
        groupBy: '$engagementScore',
        boundaries: [0, 20, 40, 60, 80, 100],
        default: 'Other',
        output: { count: { $sum: 1 } }
      }
    }
  ]);

  // Top interests
  const topInterests = await User.aggregate([
    { $match: { areaOfInterest: { $exists: true, $ne: '' } } },
    { $group: { _id: '$areaOfInterest', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);

  // Gender distribution
  const genderDistribution = await User.aggregate([
    { $match: { gender: { $exists: true, $ne: '' } } },
    { $group: { _id: '$gender', count: { $sum: 1 } } }
  ]);

  // Active users by day of week
  const activeByDayOfWeekRaw = await User.aggregate([
    { $match: { lastUpdated: { $gte: startDate } } },
    {
      $group: {
        _id: { $dayOfWeek: '$lastUpdated' },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  // Normalize to ensure all 7 days exist (MongoDB $dayOfWeek: 1=Sunday, 2=Monday, ..., 7=Saturday)
  // Convert to 0-6 array (Sunday=0, Monday=1, ..., Saturday=6)
  const activeByDayOfWeek = Array(7).fill(0).map((_, index) => {
    const mongoDay = index + 1; // MongoDB: 1=Sunday, 2=Monday, etc.
    const dayData = activeByDayOfWeekRaw.find(d => d._id === mongoDay);
    return dayData ? dayData.count : 0;
  });

  res.render('admin/analytics', {
    title: 'Analytics Dashboard',
    userGrowth,
    engagementDistribution,
    topInterests,
    genderDistribution,
    activeByDayOfWeek,
    days,
    admin: req.adminUser,
    nonce: res.locals.nonce
  });
}));

// ======================================================
// 👥 ENHANCED USER MANAGEMENT
// ======================================================
router.get('/users', wrapAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search || '';
  const sort = req.query.sort || '-createdAt';
  const filter = req.query.filter || 'all';

  let query = {};

  // Apply search
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { id: { $regex: search, $options: 'i' } }
    ];
  }

  // Apply filters
  switch (filter) {
    case 'active':
      query.lastUpdated = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
      break;
    case 'inactive':
      query.lastUpdated = { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
      break;
    case 'new':
      query.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
      break;
    case 'admins':
      query.isAdmin = true;
      break;
  }

  const [users, total] = await Promise.all([
    User.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .select('id name email picture createdAt lastUpdated role isAdmin status personalityScores engagementScore'),
    User.countDocuments(query)
  ]);


  res.render('admin/users', {
    title: 'User Management',
    users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    search,
    sort,
    filter,
    admin: req.adminUser,
    nonce: res.locals.nonce
  });
}));

// ======================================================
// 👤 USER DETAIL PAGE - Enhanced
// ======================================================
router.get('/users/:id', wrapAsync(async (req, res) => {
  const user = await User.findOne({ id: req.params.id });
  if (!user) {
    if (req.accepts('json')) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
    req.flash('error', 'User not found');
    return res.redirect('/admin/users');
  }

  // Get user sessions
  const sessions = await UserToken.find({ userId: user.id })
    .sort({ createdAt: -1 })
    .limit(20);

  // Get user analytics safely
  const userAnalytics = analytics.getUserStats ? analytics.getUserStats(user.id) : {};

  // Calculate user metrics
  const metrics = {
    totalPosts: user.feedData?.length || 0,
    totalLikes: user.likes?.length || 0,
    totalAlbums: user.albumsData?.length || 0,
    accountAge: Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
    lastActive: user.lastUpdated ? 
      Math.floor((Date.now() - new Date(user.lastUpdated).getTime()) / (1000 * 60 * 60 * 24)) : 
      null,
    activeSessions: sessions.filter(s => s.isValid && new Date(s.expiresAt) > new Date()).length
  };

  // Get activity timeline
  const activityTimeline = [
    { 
      type: 'joined', 
      date: user.createdAt, 
      description: 'Account created' 
    },
    ...sessions.slice(0, 5).map(s => ({
      type: 'login',
      date: s.createdAt,
      description: `Login from ${s.ipAddress || 'unknown IP'}`,
      details: s.userAgent
    })),
    ...(user.lastUpdated ? [{
      type: 'analysis',
      date: user.lastUpdated,
      description: 'Profile analysis updated'
    }] : [])
  ].sort((a, b) => new Date(b.date) - new Date(a.date));


  res.render('admin/user-detail', {
    title: `User: ${user.name}`,
    user,
    sessions,
    userAnalytics,
    metrics,
    activityTimeline,
    admin: req.adminUser,
    nonce: res.locals.nonce
  });
}));

// ======================================================
// 🔄 BULK USER OPERATIONS
// ======================================================
router.post('/users/bulk', wrapAsync(async (req, res) => {
  const { action, userIds } = req.body;

  if (!action || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid request parameters' 
    });
  }

  let result;

  switch (action) {
    case 'delete':
      // Prevent deletion of admin's own account
      const filteredIds = userIds.filter(id => id !== req.adminUser.id);
      
      result = await User.deleteMany({ id: { $in: filteredIds } });
      await UserToken.deleteMany({ userId: { $in: filteredIds } });
      
      // Clear caches safely
      if (typeof cache.clearPrefix === 'function') {
        await Promise.all(filteredIds.map(id => cache.clearPrefix(`user_${id}`).catch(() => {})));
      }
      
      logger.info('Bulk user deletion', { 
        adminId: req.adminUser.id, 
        deletedCount: result.deletedCount,
        userIds: filteredIds
      });
      break;

    case 'activate':
      result = await User.updateMany(
        { id: { $in: userIds } },
        { $set: { status: 'active' } }
      );
      logger.info('Bulk user activation', { 
        adminId: req.adminUser.id, 
        modifiedCount: result.modifiedCount 
      });
      break;

    case 'deactivate':
      result = await User.updateMany(
        { id: { $in: userIds } },
        { $set: { status: 'inactive' } }
      );
      logger.info('Bulk user deactivation', { 
        adminId: req.adminUser.id, 
        modifiedCount: result.modifiedCount 
      });
      break;

    case 'export':
      // Generate CSV export for selected users
      const users = await User.find({ id: { $in: userIds } }).lean();
      
      const fields = ['id', 'name', 'email', 'createdAt', 'lastUpdated', 'status'];
      const parser = new Parser({ fields });
      const csv = parser.parse(users);
      
      return res.setHeader('Content-Type', 'text/csv')
        .setHeader('Content-Disposition', `attachment; filename=users-export-${Date.now()}.csv`)
        .send(csv);

    default:
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid action' 
      });
  }

  if (analytics.track) {
    analytics.track('admin_bulk_operation', { 
      adminId: req.adminUser.id, 
      action, 
      count: userIds.length 
    });
  }

  res.json({ 
    success: true, 
    message: `${action} completed successfully`,
    affected: result?.modifiedCount || result?.deletedCount || userIds.length
  });
}));

// ======================================================
// 🔧 USER UPDATE
// ======================================================
router.put('/users/:id', wrapAsync(async (req, res) => {
  const { role, isAdmin, status } = req.body;
  const updateFields = {};
  
  if (role !== undefined) updateFields.role = role;
  if (isAdmin !== undefined) updateFields.isAdmin = isAdmin;
  if (status !== undefined) updateFields.status = status;

  const user = await User.findOneAndUpdate(
    { id: req.params.id }, 
    { $set: updateFields }, 
    { new: true }
  );

  if (!user) {
    return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
  }

  logger.info('Admin updated user', { 
    adminId: req.adminUser.id, 
    userId: user.id, 
    updates: updateFields 
  });

  if (analytics.track) {
    analytics.track('admin_user_updated', { 
      adminId: req.adminUser.id, 
      userId: user.id 
    });
  }

  // Clear user cache safely
  if (typeof cache.clearPrefix === 'function') {
    await cache.clearPrefix(`user_${user.id}`).catch(() => {});
  }

  res.json({ success: true, user });
}));

// ======================================================
// 🗑️ USER DELETION
// ======================================================
router.delete('/users/:id', wrapAsync(async (req, res) => {
  const userId = req.params.id;
  
  if (userId === req.adminUser.id) {
    return res.status(400).json({ 
      success: false, 
      error: 'CANNOT_DELETE_SELF' 
    });
  }

  const [user, tokens] = await Promise.all([
    User.findOneAndDelete({ id: userId }),
    UserToken.deleteMany({ userId })
  ]);

  if (!user) {
    return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
  }

  if (typeof cache.clearPrefix === 'function') {
    await cache.clearPrefix(`user_${userId}`).catch(() => {});
  }

  logger.info('Admin deleted user', { 
    adminId: req.adminUser.id, 
    userId, 
    deletedTokens: tokens.deletedCount 
  });

  if (analytics.track) {
    analytics.track('admin_user_deleted', { 
      adminId: req.adminUser.id, 
      userId 
    });
  }

  res.json({ success: true, message: 'User deleted successfully' });
}));

// ======================================================
// ⚙️ SETTINGS ROUTES
// ======================================================
router.get('/settings', wrapAsync(async (req, res) => {
  const cacheStats = await getCacheStats();
  
  const settings = {
    general: {
      siteName: config.app?.name || 'VisiSocial',
      siteDescription: config.app?.description || '',
      supportEmail: config.app?.supportEmail || '',
      adminEmail: config.app?.adminEmail || '',
      allowRegistration: config.features?.allowRegistration !== false,
      requireEmailVerification: config.features?.requireEmailVerification || false,
      enableAnalytics: config.features?.enableAnalytics !== false
    },
    security: {
      sessionDuration: config.security?.sessionDuration || 24,
      maxLoginAttempts: config.security?.maxLoginAttempts || 5,
      lockoutDuration: config.security?.lockoutDuration || 15,
      passwordMinLength: config.security?.passwordMinLength || 8,
      tokenExpiry: config.security?.tokenExpiry || 7,
      enable2FA: config.security?.enable2FA || false,
      ipWhitelisting: config.security?.ipWhitelisting || false,
      csrfProtection: config.security?.csrfProtection !== false
    },
    api: {
      rateLimit: config.rateLimit?.max || 1000,
      burstLimit: config.rateLimit?.burst || 50,
      openaiKey: process.env.OPENAI_API_KEY ? '••••••••' : '',
      facebookSecret: process.env.FACEBOOK_FACEBOOK_APP_SECRET ? '••••••••' : '',
      publicApiAccess: config.api?.publicAccess || false,
      requireApiKey: config.api?.requireKey !== false
    },
    email: {
      smtpHost: process.env.SMTP_HOST || '',
      smtpPort: process.env.SMTP_PORT || 587,
      smtpUsername: process.env.SMTP_USERNAME || '',
      smtpPassword: process.env.SMTP_PASSWORD ? '••••••••' : '',
      fromEmail: process.env.EMAIL_FROM || '',
      sendWelcomeEmail: config.email?.sendWelcome !== false,
      sendAnalysisEmail: config.email?.sendAnalysis !== false
    },
    cache: {
      ttl: config.cache?.ttl || 3600,
      maxSize: config.cache?.maxSize || 100,
      currentSize: cacheStats.size,
      itemCount: cacheStats.items
    },
    maintenance: {
      enabled: config.maintenance?.enabled || false,
      message: config.maintenance?.message || '',
      estimatedTime: config.maintenance?.estimatedTime || 2
    },
    backup: {
      autoBackup: config.backup?.auto || false,
      lastBackup: config.backup?.lastBackup || 'Never'
    }
  };

  res.render('admin/settings', {
    title: 'Admin Settings',
    settings,
    admin: req.adminUser,
    nonce: res.locals.nonce
  });
}));

router.post('/settings', wrapAsync(async (req, res) => {
  const { section, data } = req.body;

  switch (section) {
    case 'general':
      config.app = { ...config.app, ...data };
      break;
    
    case 'security':
      config.security = { ...config.security, ...data };
      break;
    
    case 'api':
      config.api = { ...config.api, ...data };
      if (data.openaiKey && data.openaiKey !== '••••••••') {
        process.env.OPENAI_API_KEY = data.openaiKey;
      }
      if (data.facebookSecret && data.facebookSecret !== '••••••••') {
        process.env.FACEBOOK_FACEBOOK_APP_SECRET = data.facebookSecret;
      }
      break;
    
    case 'email':
      config.email = { ...config.email, ...data };
      if (data.smtpPassword && data.smtpPassword !== '••••••••') {
        process.env.SMTP_PASSWORD = data.smtpPassword;
      }
      break;
    
    case 'maintenance':
      config.maintenance = { ...config.maintenance, ...data };
      break;
    
    default:
      return res.status(400).json({ success: false, error: 'Invalid section' });
  }

  logger.info('Settings updated', {
    section,
    adminId: req.adminUser.id,
    timestamp: new Date()
  });

  if (analytics.track) {
    analytics.track('admin_settings_updated', {
      adminId: req.adminUser.id,
      section
    });
  }

  res.json({ success: true, message: 'Settings saved successfully' });
}));

// ======================================================
// 💾 CACHE MANAGEMENT
// ======================================================
router.post('/cache/clear', wrapAsync(async (req, res) => {
  const { type } = req.body;

  let cleared = 0;

  try {
    switch (type) {
      case 'all':
        if (typeof cache.clear === 'function') {
          cleared = await cache.clear();
        }
        logger.info('Admin cleared all cache', { adminId: req.adminUser.id });
        break;

      case 'users':
        if (typeof cache.clearPrefix === 'function') {
          cleared = await cache.clearPrefix('user_');
        }
        logger.info('Admin cleared user cache', { adminId: req.adminUser.id });
        break;

      case 'api':
        if (typeof cache.clearPrefix === 'function') {
          cleared = await cache.clearPrefix('api_');
        }
        logger.info('Admin cleared API cache', { adminId: req.adminUser.id });
        break;

      case 'analysis':
        if (typeof cache.clearPrefix === 'function') {
          await cache.clearPrefix('personality_');
          cleared = await cache.clearPrefix('insights_');
        }
        logger.info('Admin cleared analysis cache', { adminId: req.adminUser.id });
        break;

      default:
        return res.status(400).json({ success: false, error: 'Invalid cache type' });
    }

    if (analytics.track) {
      analytics.track('admin_cache_cleared', { 
        adminId: req.adminUser.id, 
        type,
        cleared 
      });
    }

    res.json({ 
      success: true, 
      message: `Cache cleared successfully`,
      cleared 
    });

  } catch (error) {
    logger.error('Cache clear error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: 'Failed to clear cache' 
    });
  }
}));

router.get('/cache/stats', wrapAsync(async (req, res) => {
  const stats = await getCacheStats();
  stats.ttl = config.cache?.ttl || 3600;
  
  res.json({ success: true, stats });
}));

// ======================================================
// 📋 ACTIVITY LOGS
// ======================================================
router.get('/logs', wrapAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const level = req.query.level || 'all';
  const search = req.query.search || '';

  // Get logs from analytics safely
  let events = [];
  let total = 0;

  if (analytics.getEvents && typeof analytics.getEvents === 'function') {
    events = analytics.getEvents({
      limit: limit,
      offset: (page - 1) * limit,
      level: level !== 'all' ? level : undefined,
      search: search || undefined
    });
  }

  if (analytics.getEventCount && typeof analytics.getEventCount === 'function') {
    total = analytics.getEventCount({
      level: level !== 'all' ? level : undefined,
      search: search || undefined
    });
  }



  res.render('admin/logs', {
    title: 'Activity Logs',
    logs: events,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    level,
    search,
    admin: req.adminUser,
    nonce: res.locals.nonce
  });
}));

// ======================================================
// 🔍 SYSTEM HEALTH
// ======================================================
router.get('/health', wrapAsync(async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: {
        status: mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy',
        responseTime: null
      },
      cache: {
        status: 'unknown',
        responseTime: null
      },
      memory: {
        status: 'healthy',
        usage: process.memoryUsage()
      },
      cpu: {
        status: 'healthy',
        load: os.loadavg()
      }
    }
  };

  // Test database
  try {
    const start = Date.now();
    await mongoose.connection.db.admin().ping();
    health.checks.database.responseTime = Date.now() - start;
  } catch (error) {
    health.checks.database.status = 'unhealthy';
    health.status = 'degraded';
  }

  // Test cache
  try {
    const start = Date.now();
    if (typeof cache.get === 'function') {
      await cache.get('health_check');
      health.checks.cache.responseTime = Date.now() - start;
      health.checks.cache.status = 'healthy';
    }
  } catch (error) {
    health.checks.cache.status = 'unhealthy';
    health.status = 'degraded';
  }

  res.json(health);
}));

// ======================================================
// 📤 DATA EXPORT
// ======================================================
router.get('/export/users', wrapAsync(async (req, res) => {
  const format = req.query.format || 'csv';

  const users = await User.find()
    .select('id name email createdAt lastUpdated status personalityScores engagementScore')
    .lean();

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=users-${Date.now()}.json`);
    return res.json(users);
  }

  // CSV export
  const fields = [
    'id', 'name', 'email', 'status', 'createdAt', 'lastUpdated',
    'personalityScores.openness', 'personalityScores.conscientiousness',
    'personalityScores.extroversion', 'personalityScores.agreeableness',
    'personalityScores.neuroticism', 'engagementScore'
  ];

  const parser = new Parser({ fields });
  const csv = parser.parse(users);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=users-${Date.now()}.csv`);
  res.send(csv);

  logger.info('Admin exported user data', { 
    adminId: req.adminUser.id, 
    format, 
    count: users.length 
  });
}));

// ======================================================
// 🔄 SYSTEM BACKUP
// ======================================================
router.post('/backup/create', wrapAsync(async (req, res) => {
  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = `backup-${timestamp}.zip`;
  const filepath = path.join(backupDir, filename);

  const output = fs.createWriteStream(filepath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.pipe(output);

  // Export all users
  const users = await User.find().lean();
  archive.append(JSON.stringify(users, null, 2), { name: 'users.json' });

  // Export all tokens
  const tokens = await UserToken.find().lean();
  archive.append(JSON.stringify(tokens, null, 2), { name: 'tokens.json' });

  // Export configuration
  const configData = {
    app: config.app,
    features: config.features,
    security: config.security,
    exportDate: new Date().toISOString()
  };
  archive.append(JSON.stringify(configData, null, 2), { name: 'config.json' });

  await archive.finalize();

  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });

  logger.info('System backup created', { 
    adminId: req.adminUser.id, 
    filename,
    size: archive.pointer()
  });

  res.json({ 
    success: true, 
    message: 'Backup created successfully',
    filename,
    size: archive.pointer()
  });
}));

// ======================================================
// 🔍 SEARCH
// ======================================================
router.get('/search', wrapAsync(async (req, res) => {
  const query = req.query.q;
  const type = req.query.type || 'all';

  if (!query) {
    return res.status(400).json({ 
      success: false, 
      error: 'Search query required' 
    });
  }

  const results = {
    users: [],
    logs: [],
    sessions: []
  };

  if (type === 'all' || type === 'users') {
    results.users = await User.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
        { id: { $regex: query, $options: 'i' } }
      ]
    }).limit(10).select('id name email picture');
  }

  if (type === 'all' || type === 'sessions') {
    results.sessions = await UserToken.find({
      $or: [
        { userId: { $regex: query, $options: 'i' } },
        { ipAddress: { $regex: query, $options: 'i' } }
      ]
    }).limit(10);
  }

  res.json({ success: true, results });
}));

// ======================================================
// ⚠️ GLOBAL ERROR HANDLER
// ======================================================
router.use((err, req, res, next) => {
  logger.error('Admin route error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    adminId: req.adminUser?.id
  });

  const redirectUrl = req.get('Referer') || '/admin';

  if (req.accepts('json')) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.code || 'ADMIN_ERROR',
      message: config.server?.isProduction ? 'An error occurred' : err.message
    });
  }

  req.flash('error', err.message || 'An error occurred');
  res.status(err.status || 500).render('error', {
    title: 'Error',
    err,
    nonce: res.locals.nonce,
    redirectUrl,
    showDetails: process.env.NODE_ENV !== 'production'
  });
});

module.exports = router;