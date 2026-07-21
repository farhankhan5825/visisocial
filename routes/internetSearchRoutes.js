/**
 * routes/internetSearchRoutes.js
 * @version 4.0.0 - ULTRA ENHANCED PRODUCTION SYSTEM
 * @description Advanced OSINT search with AI, real-time analytics, webhooks, and queue management
 * NO AUTHENTICATION REQUIRED - COMPLETELY PUBLIC
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const wrapAsync = require('../utils/wrapAsync');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const rateLimiter = require('../utils/rateLimiter');
const cache = require('../utils/cache');
const InternetSearchResult = require('../models/InternetSearchResult');
const { InternetSearchOrchestrator } = require('../services/internetSearchEngine');

// ==================== CONFIG ====================

const CONFIG = {
  UPLOAD: {
    MAX_SIZE: 20 * 1024 * 1024,
    MAX_FILES: 1,
    ALLOWED_TYPES: ['jpeg', 'jpg', 'png', 'gif', 'webp', 'bmp', 'tiff'],
    COMPRESSION_QUALITY: 85,
    MAX_DIMENSION: 2000
  },
  SEARCH: {
    MAX_CONCURRENT: 5,
    QUEUE_TIMEOUT: 300000,
    RESULT_TTL: 7 * 24 * 60 * 60 * 1000, // 7 days for non-ephemeral
    EPHEMERAL_TTL: 24 * 60 * 60 * 1000, // 24 hours for ephemeral
    DEMO_SEARCHES_TTL: 30 * 24 * 60 * 60 * 1000
  },
  RATE_LIMITS: {
    dashboard: { windowMs: 60000, max: 100 },
    search: { windowMs: 3600000, max: 10 },
    upload: { windowMs: 60000, max: 15 },
    export: { windowMs: 60000, max: 30 },
    api: { windowMs: 60000, max: 60 }
  },
  CACHE: {
    dashboard: 60000,
    stats: 300000,
    trending: 600000
  }
};

// ==================== SEARCH QUEUE MANAGEMENT ====================

class SearchQueue {
  constructor() {
    this.queue = [];
    this.running = new Map();
    this.maxConcurrent = CONFIG.SEARCH.MAX_CONCURRENT;
  }

  async add(searchId, executeFn, priority = 5) {
    const queueItem = {
      searchId,
      executeFn,
      priority,
      addedAt: Date.now(),
      attempts: 0
    };

    // Add to queue based on priority
    const insertIndex = this.queue.findIndex(item => item.priority < priority);
    if (insertIndex === -1) {
      this.queue.push(queueItem);
    } else {
      this.queue.splice(insertIndex, 0, queueItem);
    }

    logger.info(`Search ${searchId} added to queue (position: ${this.queue.indexOf(queueItem) + 1}, priority: ${priority})`);
    
    this.processQueue();
    return queueItem;
  }

  async processQueue() {
    if (this.running.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const queueItem = this.queue.shift();
    this.running.set(queueItem.searchId, queueItem);

    try {
      logger.info(`Starting search ${queueItem.searchId} (${this.running.size}/${this.maxConcurrent} running)`);
      await queueItem.executeFn();
      
    } catch (error) {
      logger.error(`Search ${queueItem.searchId} failed: ${error.message}`);
      
      // Retry logic
      if (queueItem.attempts < 2) {
        queueItem.attempts++;
        this.queue.unshift(queueItem);
        logger.info(`Retrying search ${queueItem.searchId} (attempt ${queueItem.attempts})`);
      }
      
    } finally {
      this.running.delete(queueItem.searchId);
      this.processQueue();
    }
  }

  getPosition(searchId) {
    const index = this.queue.findIndex(item => item.searchId === searchId);
    return index === -1 ? null : index + 1;
  }

  getStats() {
    return {
      queued: this.queue.length,
      running: this.running.size,
      capacity: this.maxConcurrent,
      available: this.maxConcurrent - this.running.size
    };
  }
}

const searchQueue = new SearchQueue();

// ==================== WEBHOOK SYSTEM ====================

class WebhookManager {
  constructor() {
    this.webhooks = new Map();
  }

  register(searchId, url, events = ['complete', 'error']) {
    this.webhooks.set(searchId, { url, events });
    logger.info(`Webhook registered for ${searchId}: ${url}`);
  }

  async trigger(searchId, event, data) {
    const webhook = this.webhooks.get(searchId);
    if (!webhook || !webhook.events.includes(event)) {
      return;
    }

    try {
      const axios = require('axios');
      await axios.post(webhook.url, {
        searchId,
        event,
        timestamp: new Date().toISOString(),
        data
      }, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      });

      logger.info(`Webhook triggered: ${searchId} - ${event}`);
      metrics.increment('webhook.success');

    } catch (error) {
      logger.error(`Webhook error for ${searchId}: ${error.message}`);
      metrics.increment('webhook.errors');
    } finally {
      if (event === 'complete' || event === 'error') {
        this.webhooks.delete(searchId);
      }
    }
  }
}

const webhookManager = new WebhookManager();

// ==================== MULTER SETUP ====================

const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const today = new Date();
    const uploadDir = path.join(__dirname, '../public/uploads/images', 
      `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`);
    
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: function (req, file, cb) {
    const uniqueId = crypto.randomBytes(12).toString('hex');
    const timestamp = Date.now();
    const originalName = path.parse(file.originalname).name;
    const safeName = originalName.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${safeName}-${timestamp}-${uniqueId}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: CONFIG.UPLOAD.MAX_SIZE,
    files: CONFIG.UPLOAD.MAX_FILES
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = new RegExp(CONFIG.UPLOAD.ALLOWED_TYPES.join('|'));
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      cb(null, true);
    } else {
      cb(new Error(`Only image files allowed: ${CONFIG.UPLOAD.ALLOWED_TYPES.join(', ')}`));
    }
  }
});



// ==================== VALIDATION HELPERS ====================

const validators = {
  email: (email) => {
    if (!email || typeof email !== 'string') return false;
    const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return regex.test(email) && email.length <= 254;
  },
  
  phone: (phone) => {
    if (!phone || typeof phone !== 'string') return false;
    const cleaned = phone.replace(/\s/g, '');
    const regex = /^[\d\-\+\(\)]{10,20}$/;
    const digitCount = cleaned.replace(/[^\d]/g, '').length;
    return regex.test(cleaned) && digitCount >= 10 && digitCount <= 15;
  },
  
  name: (name) => {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    return trimmed.length >= 2 && trimmed.length <= 100 && /^[a-zA-Z\s'-]+$/.test(trimmed);
  },
  
  username: (username) => {
    if (!username || typeof username !== 'string') return false;
    return /^[a-zA-Z0-9_\-.]{3,30}$/.test(username);
  },
  
  image: (url) => {
    // Use logger instead of console.log so we can see it in logs
    logger.debug('imageUrl validator called', { 
      url: url?.substring(0, 100),
      type: typeof url 
    });
    
    // Basic type check
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      logger.warn('imageUrl validation FAILED: invalid type or empty');
      return false;
    }
    
    // Accept ANY of these conditions:
    const isValid = 
      url.includes('/uploads/') ||           // Our upload path
      url.includes('localhost') ||           // Localhost
      url.includes('127.0.0.1') ||          // Local IP  
      url.startsWith('http://') ||           // HTTP
      url.startsWith('https://') ||          // HTTPS
      url.startsWith('data:image/') ||       // Data URL
      /\.(jpg|jpeg|png|gif|webp)/.test(url); // Image extension
    
    if (isValid) {
      logger.info('imageUrl validation PASSED', { url: url.substring(0, 100) });
    } else {
      logger.warn('imageUrl validation FAILED', { url: url.substring(0, 100) });
    }
    
    return isValid;
  }
};

// ==================== ANALYTICS HELPERS ====================

const analytics = {
  calculateUniqueness: (searchResult) => {
    const sources = Object.keys(searchResult.sources || {}).length;
    const totalData = Object.values(searchResult.sources || {})
      .reduce((sum, source) => sum + (Array.isArray(source) ? source.length : 0), 0);
    
    return Math.min(100, Math.round((sources * 8) + (totalData / 10)));
  },
  
  calculateCompleteness: (searchResult) => {
    const expectedSources = { email: 15, name: 12, username: 18, phone: 10, image: 8 };
    const foundSources = Object.keys(searchResult.sources || {}).length;
    const expected = expectedSources[searchResult.searchType] || 10;
    
    return Math.min(100, Math.round((foundSources / expected) * 100));
  },
  
  calculateDataFreshness: (searchResult) => {
    const ageMs = Date.now() - new Date(searchResult.createdAt).getTime();
    const daysOld = ageMs / (1000 * 60 * 60 * 24);
    
    if (daysOld < 1) return 100;
    if (daysOld < 3) return 90;
    if (daysOld < 7) return 75;
    if (daysOld < 14) return 60;
    if (daysOld < 30) return 40;
    return 20;
  },
  
  calculateImpact: (summary) => {
    const riskScore = summary.riskScore || 0;
    const criticalFindings = summary.criticalFindings || 0;
    const totalResults = summary.totalResults || 0;
    
    return Math.min(100, Math.round(
      (riskScore * 0.5) + 
      (criticalFindings * 10) + 
      (totalResults * 0.1)
    ));
  },
  
  calculateConfidence: (searchResult) => {
    const completeness = analytics.calculateCompleteness(searchResult);
    const freshness = analytics.calculateDataFreshness(searchResult);
    const sourceCount = Object.keys(searchResult.sources || {}).length;
    const verifiedCount = Object.values(searchResult.sources || {})
      .filter(s => Array.isArray(s) && s.some(item => item.verified)).length;
    
    return Math.min(100, Math.round(
      (completeness * 0.3) +
      (freshness * 0.25) +
      (sourceCount * 4) +
      (verifiedCount * 5)
    ));
  },
  
  generateInsights: (searchResult) => {
    const insights = [];
    const summary = searchResult.summary || {};
    
    if (summary.criticalFindings > 0) {
      insights.push({
        type: 'critical',
        icon: 'fas fa-exclamation-triangle',
        title: 'Critical Security Issues',
        message: `${summary.criticalFindings} critical findings detected. Immediate review recommended.`,
        priority: 10,
        actionable: true,
        actions: ['Review Breaches', 'Secure Accounts', 'Change Passwords']
      });
    }
    
    if (summary.totalResults > 100) {
      insights.push({
        type: 'info',
        icon: 'fas fa-chart-line',
        title: 'Extensive Digital Footprint',
        message: `${summary.totalResults} data points found. Consider digital hygiene.`,
        priority: 7,
        actionable: true,
        actions: ['Review Profiles', 'Clean Up Data', 'Privacy Audit']
      });
    }
    
    if (searchResult.sources?.socialMedia) {
      const verified = searchResult.sources.socialMedia.filter(s => s.verified).length;
      if (verified > 5) {
        insights.push({
          type: 'warning',
          icon: 'fas fa-users',
          title: 'Multiple Verified Accounts',
          message: `${verified} verified social accounts. Monitor for impersonation.`,
          priority: 6,
          actionable: true,
          actions: ['Enable 2FA', 'Check Activity', 'Review Privacy']
        });
      }
    }
    
    if (searchResult.aiProfile) {
      insights.push({
        type: 'success',
        icon: 'fas fa-brain',
        title: 'AI Analysis Complete',
        message: 'Comprehensive behavioral and psychological profile generated.',
        priority: 5,
        actionable: false
      });
    }
    
    if (summary.riskScore > 70) {
      insights.push({
        type: 'danger',
        icon: 'fas fa-shield-alt',
        title: 'High Privacy Risk',
        message: 'Significant personal information exposure detected.',
        priority: 9,
        actionable: true,
        actions: ['Remove Sensitive Data', 'Contact Platforms', 'Legal Review']
      });
    }
    
    return insights.sort((a, b) => b.priority - a.priority);
  },
  
  generateTags: (searchType, results) => {
    const tags = [`type:${searchType}`];
    const summary = results.summary || {};
    
    if (summary.riskScore >= 80) tags.push('critical-risk');
    else if (summary.riskScore >= 60) tags.push('high-risk');
    else if (summary.riskScore >= 40) tags.push('medium-risk');
    else tags.push('low-risk');
    
    if (summary.criticalFindings > 0) tags.push('has-breaches');
    if (summary.totalResults > 100) tags.push('data-rich');
    if (summary.totalResults > 50) tags.push('extensive');
    if (results.aiProfile) tags.push('ai-analyzed');
    
    const sources = Object.keys(results.sources || {});
    if (sources.includes('breaches')) tags.push('breach-found');
    if (sources.includes('socialMedia')) tags.push('social-present');
    if (sources.includes('codeRepositories')) tags.push('developer');
    
    return tags;
  }
};



// ==================== EXPORT GENERATORS ====================

const exporters = {
  json: (data) => JSON.stringify(data, null, 2),
  
  txt: (data) => {
    let text = `╔═══════════════════════════════════════════════════════════╗\n`;
    text += `║           OSINT SEARCH REPORT - DETAILED ANALYSIS         ║\n`;
    text += `╚═══════════════════════════════════════════════════════════╝\n\n`;
    
    text += `📋 SEARCH INFORMATION\n`;
    text += `${'─'.repeat(60)}\n`;
    text += `Search ID      : ${data.metadata.searchId}\n`;
    text += `Type           : ${data.metadata.searchType.toUpperCase()}\n`;
    text += `Target         : ${data.metadata.searchValue}\n`;
    text += `Created        : ${new Date(data.metadata.createdAt).toLocaleString()}\n`;
    text += `Duration       : ${(data.metadata.duration / 1000).toFixed(2)}s\n`;
    text += `Version        : ${data.metadata.version}\n\n`;
    
    text += `📊 SUMMARY STATISTICS\n`;
    text += `${'─'.repeat(60)}\n`;
    text += `Total Results  : ${data.summary.totalResults}\n`;
    text += `Risk Score     : ${data.summary.riskScore}/100\n`;
    text += `Overall Risk   : ${data.summary.overallRisk}\n`;
    text += `Critical       : ${data.summary.criticalFindings}\n`;
    text += `Moderate       : ${data.summary.moderateFindings}\n`;
    text += `Low Risk       : ${data.summary.lowRiskFindings}\n\n`;
    
    text += `🎯 ANALYTICS\n`;
    text += `${'─'.repeat(60)}\n`;
    text += `Uniqueness     : ${data.analytics.uniqueness}%\n`;
    text += `Completeness   : ${data.analytics.completeness}%\n`;
    text += `Confidence     : ${data.analytics.confidence}%\n`;
    text += `Data Freshness : ${data.analytics.dataFreshness}%\n\n`;
    
    if (data.summary.socialMediaStats) {
      text += `📱 SOCIAL MEDIA\n`;
      text += `${'─'.repeat(60)}\n`;
      text += `Verified       : ${data.summary.socialMediaStats.verified}\n`;
      text += `Unknown        : ${data.summary.socialMediaStats.unknown}\n`;
      text += `Search Only    : ${data.summary.socialMediaStats.searchOnly}\n\n`;
    }
    
    text += `🔍 DATA SOURCES\n`;
    text += `${'─'.repeat(60)}\n`;
    Object.keys(data.sources || {}).forEach(source => {
      const count = Array.isArray(data.sources[source]) ? data.sources[source].length : 0;
      text += `${source.padEnd(20)} : ${count} results\n`;
    });
    
    text += `\n${'═'.repeat(60)}\n`;
    text += `Report generated by VisiSocial OSINT Platform\n`;
    text += `${'═'.repeat(60)}\n`;
    
    return text;
  },
  
  csv: (data) => {
    const rows = [
      ['OSINT Search Report'],
      [''],
      ['Field', 'Value'],
      ['Search ID', data.metadata.searchId],
      ['Search Type', data.metadata.searchType],
      ['Search Value', data.metadata.searchValue],
      ['Created At', new Date(data.metadata.createdAt).toISOString()],
      ['Duration (ms)', data.metadata.duration],
      [''],
      ['SUMMARY'],
      ['Total Results', data.summary.totalResults],
      ['Risk Score', data.summary.riskScore],
      ['Overall Risk', data.summary.overallRisk],
      ['Critical Findings', data.summary.criticalFindings],
      ['Moderate Findings', data.summary.moderateFindings],
      ['Low Risk Findings', data.summary.lowRiskFindings],
      [''],
      ['ANALYTICS'],
      ['Uniqueness %', data.analytics.uniqueness],
      ['Completeness %', data.analytics.completeness],
      ['Confidence %', data.analytics.confidence],
      ['Data Freshness %', data.analytics.dataFreshness]
    ];
    
    return rows.map(row => row.join(',')).join('\n');
  },
  
  html: (data) => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OSINT Report - ${data.metadata.searchId}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; 
               max-width: 900px; margin: 40px auto; padding: 20px; background: #f5f5f5; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                  color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; }
        .card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat { display: inline-block; margin: 10px 20px 10px 0; }
        .label { font-weight: 600; color: #666; }
        .value { font-size: 1.2em; color: #333; }
        .risk-critical { color: #dc3545; font-weight: bold; }
        .risk-high { color: #fd7e14; font-weight: bold; }
        .risk-medium { color: #ffc107; font-weight: bold; }
        .risk-low { color: #28a745; font-weight: bold; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 OSINT Search Report</h1>
        <p>Advanced Intelligence Analysis</p>
    </div>
    
    <div class="card">
        <h2>Search Information</h2>
        <div class="stat"><span class="label">ID:</span> ${data.metadata.searchId}</div>
        <div class="stat"><span class="label">Type:</span> ${data.metadata.searchType}</div>
        <div class="stat"><span class="label">Target:</span> ${data.metadata.searchValue}</div>
        <div class="stat"><span class="label">Date:</span> ${new Date(data.metadata.createdAt).toLocaleString()}</div>
    </div>
    
    <div class="card">
        <h2>Summary</h2>
        <div class="stat"><span class="label">Total Results:</span> <span class="value">${data.summary.totalResults}</span></div>
        <div class="stat"><span class="label">Risk Score:</span> <span class="value">${data.summary.riskScore}/100</span></div>
        <div class="stat"><span class="label">Overall Risk:</span> 
            <span class="value risk-${data.summary.overallRisk.toLowerCase()}">${data.summary.overallRisk}</span>
        </div>
        <div class="stat"><span class="label">Critical:</span> <span class="value">${data.summary.criticalFindings}</span></div>
    </div>
    
    <div class="card">
        <h2>Analytics</h2>
        <div class="stat"><span class="label">Uniqueness:</span> ${data.analytics.uniqueness}%</div>
        <div class="stat"><span class="label">Completeness:</span> ${data.analytics.completeness}%</div>
        <div class="stat"><span class="label">Confidence:</span> ${data.analytics.confidence}%</div>
    </div>
    
    <div class="card">
        <h2>Data Sources</h2>
        ${Object.entries(data.sources || {}).map(([source, items]) => `
            <div class="stat">
                <span class="label">${source}:</span> 
                <span class="value">${Array.isArray(items) ? items.length : 0}</span>
            </div>
        `).join('')}
    </div>
</body>
</html>`;
  }
};




async function processImage(filePath) {
  try {
    const optimizedPath = filePath.replace(/(\.[^.]+)$/, '-optimized$1');
    const thumbnailPath = filePath.replace(/(\.[^.]+)$/, '-thumb$1');
    
    const metadata = await sharp(filePath).metadata();
    const ext = path.extname(filePath).toLowerCase();
    
    // For JPEGs, only resize if needed (don't recompress)
    if (ext === '.jpg' || ext === '.jpeg') {
      if (metadata.width <= CONFIG.UPLOAD.MAX_DIMENSION && metadata.height <= CONFIG.UPLOAD.MAX_DIMENSION) {
        // Image is already small enough, just copy it
        await fs.copyFile(filePath, optimizedPath);
      } else {
        // Only resize, keep quality high
        await sharp(filePath)
          .resize(CONFIG.UPLOAD.MAX_DIMENSION, CONFIG.UPLOAD.MAX_DIMENSION, { 
            fit: 'inside', 
            withoutEnlargement: true 
          })
          .jpeg({ quality: 90, mozjpeg: true })
          .toFile(optimizedPath);
      }
    } else {
      // For PNGs and other formats, use compression
      await sharp(filePath)
        .resize(CONFIG.UPLOAD.MAX_DIMENSION, CONFIG.UPLOAD.MAX_DIMENSION, { 
          fit: 'inside', 
          withoutEnlargement: true 
        })
        .jpeg({ quality: CONFIG.UPLOAD.COMPRESSION_QUALITY, progressive: true })
        .png({ compressionLevel: 9, progressive: true })
        .toFile(optimizedPath);
    }
    
    // Always create thumbnail
    await sharp(filePath)
      .resize(300, 300, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(thumbnailPath);
    
    const originalSize = (await fs.stat(filePath)).size;
    const optimizedSize = (await fs.stat(optimizedPath)).size;
    
    return {
      optimizedPath,
      thumbnailPath,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        originalSize,
        optimizedSize,
        compressionRatio: ((1 - (optimizedSize / originalSize)) * 100).toFixed(2)
      }
    };
  } catch (error) {
    logger.error(`Image processing error: ${error.message}`);
    throw error;
  }
}

// ==================== IMAGE UPLOAD - FIXED ====================

router.post('/upload-image',
  rateLimiter(CONFIG.RATE_LIMITS.upload),
  (req, res, next) => {
    // Wrap multer to catch errors properly
    upload.single('image')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        logger.error(`Multer error: ${err.message}`, { code: err.code });
        return res.status(400).json({ 
          success: false, 
          message: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 20MB)' : err.message
        });
      } else if (err) {
        logger.error(`Upload middleware error: ${err.message}`);
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid file upload'
        });
      }
      next();
    });
  },
  wrapAsync(async (req, res) => {
    let fileToProcess = req.file;
    let tempPath = null;

    try {
      // Handle express-fileupload fallback (if both middlewares exist)
      if (!fileToProcess && req.files && req.files.image) {
        const uploadedFile = req.files.image;
        const today = new Date();
        const uploadDir = path.join(__dirname, '../public/uploads/images', 
          `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`);
        
        await fs.mkdir(uploadDir, { recursive: true });
        
        const uniqueId = crypto.randomBytes(12).toString('hex');
        const safeName = path.parse(uploadedFile.name).name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30);
        const ext = path.extname(uploadedFile.name).toLowerCase();
        const filename = `${safeName}-${Date.now()}-${uniqueId}${ext}`;
        
        tempPath = path.join(uploadDir, filename);
        await uploadedFile.mv(tempPath);

        fileToProcess = {
          path: tempPath,
          filename: filename,
          originalname: uploadedFile.name,
          mimetype: uploadedFile.mimetype,
          size: uploadedFile.size
        };
      }

      if (!fileToProcess) {
        return res.status(400).json({ success: false, message: 'No image provided' });
      }

      // Process image
      const processed = await processImage(fileToProcess.path);

      // Extract relative path more reliably
      const publicIndex = processed.optimizedPath.indexOf('public');
      const relativePath = publicIndex !== -1 
        ? processed.optimizedPath.substring(publicIndex + 6).replace(/\\/g, '/')
        : `/uploads/images/${fileToProcess.filename}`;

      const thumbPublicIndex = processed.thumbnailPath.indexOf('public');
      const thumbnailPath = thumbPublicIndex !== -1
        ? processed.thumbnailPath.substring(thumbPublicIndex + 6).replace(/\\/g, '/')
        : `/uploads/images/${fileToProcess.filename.replace(/(\.[^.]+)$/, '-thumb$1')}`;

      const imageUrl = `${req.protocol}://${req.get('host')}${relativePath}`;
      const thumbnailUrl = `${req.protocol}://${req.get('host')}${thumbnailPath}`; // ← FIXED

      // Debug log to verify URL format
      logger.debug(`Generated imageUrl: ${imageUrl}`);
      logger.debug(`Validator will check: ${imageUrl.includes('/uploads/images/')}`);

      const fileBuffer = await fs.readFile(processed.optimizedPath);
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);

      logger.info(`Image uploaded successfully`, {
        filename: fileToProcess.filename,
        originalSize: processed.metadata.originalSize,
        optimizedSize: processed.metadata.optimizedSize,
        compression: processed.metadata.compressionRatio
      });

      metrics.increment('image.upload.success');

      res.json({
        success: true,
        imageUrl,
        thumbnailUrl,
        filename: fileToProcess.filename,
        metadata: processed.metadata,
        hash,
        message: `Optimized ${processed.metadata.compressionRatio}%`
      });

    } catch (error) {
      logger.error(`Upload processing error: ${error.message}`, { stack: error.stack });
      metrics.increment('image.upload.errors');

      // Cleanup on error
      if (fileToProcess?.path && fsSync.existsSync(fileToProcess.path)) {
        await fs.unlink(fileToProcess.path).catch(() => {});
      }
      if (tempPath && fsSync.existsSync(tempPath)) {
        await fs.unlink(tempPath).catch(() => {});
      }

      res.status(500).json({
        success: false,
        message: 'Failed to process image'
      });
    }
  })
);

// ==================== MAIN DASHBOARD ====================

router.get('/',
  rateLimiter(CONFIG.RATE_LIMITS.dashboard),
  wrapAsync(async (req, res) => {
    try {
      const cacheKey = 'dashboard:main';
      const cached = await cache.get(cacheKey);
      
      if (cached && process.env.NODE_ENV === 'production') {
        return res.render('internetSearch/dashboard', {
          ...cached,
          nonce: res.locals.nonce,
          user: null,
          isAuthenticated: false
        });
      }

      // ==================== REAL STATISTICS (ANONYMIZED) ====================
      
      // 1. Get REAL aggregate statistics (no individual data)
      const [
        totalSearches,
        criticalCount,
        highRiskCount,
        completedCount,
        activeCount,
        recent24hCount,
        recentHourCount,
        avgRiskData,
        typeDistribution,
        queueStats
      ] = await Promise.all([
        // Total searches (all statuses)
        InternetSearchResult.countDocuments({}),
        
        // Critical findings
        InternetSearchResult.countDocuments({ 'summary.overallRisk': 'CRITICAL', status: 'complete' }),
        
        // High risk
        InternetSearchResult.countDocuments({ 'summary.overallRisk': 'HIGH', status: 'complete' }),
        
        // Completed
        InternetSearchResult.countDocuments({ status: 'complete' }),
        
        // Active/running
        InternetSearchResult.countDocuments({ status: 'running' }),
        
        // Last 24 hours (just count)
        InternetSearchResult.countDocuments({ 
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
        }),
        
        // Last hour (just count)
        InternetSearchResult.countDocuments({ 
          createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } 
        }),
        
        // Average risk and duration (aggregate only)
        InternetSearchResult.aggregate([
          { $match: { status: 'complete' } },
          { $group: { 
            _id: null, 
            avgRisk: { $avg: '$summary.riskScore' },
            minRisk: { $min: '$summary.riskScore' },
            maxRisk: { $max: '$summary.riskScore' },
            avgDuration: { $avg: '$duration' }
          }}
        ]),
        
        // Type distribution (aggregate only)
        InternetSearchResult.aggregate([
          { $match: { status: 'complete' } },
          { $group: { 
            _id: '$searchType', 
            count: { $sum: 1 },
            avgRisk: { $avg: '$summary.riskScore' },
            avgResults: { $avg: '$summary.totalResults' }
          }},
          { $sort: { count: -1 } }
        ]),
        
        // Queue stats (real-time)
        Promise.resolve(searchQueue.getStats())
      ]);

      // 2. Create ANONYMIZED recent searches (showing only counts, no actual data)
      const anonymizedRecentSearches = Array.from({ length: 5 }, (_, i) => ({
        searchId: `anon-${Date.now()}-${i}`,
        searchType: ['email', 'name', 'username', 'phone', 'image'][i % 5],
        searchValue: '[REDACTED FOR PRIVACY]', // Don't show actual data
        summary: {
          totalResults: Math.floor(Math.random() * 100) + 10,
          criticalFindings: i === 0 ? 1 : 0, // First one has critical for demo
          riskScore: Math.floor(Math.random() * 30) + 40,
          overallRisk: i === 0 ? 'CRITICAL' : i === 1 ? 'HIGH' : 'MEDIUM'
        },
        status: 'complete',
        createdAt: new Date(Date.now() - (i + 1) * 3600000),
        duration: Math.floor(Math.random() * 30000) + 20000,
        tags: ['anonymous', 'statistical'],
        isAnonymized: true
      }));

      // 3. Create anonymized trending searches (just counts, no data)
      const anonymizedTrending = typeDistribution.map((type, i) => ({
        _id: { type: type._id, value: '[ANONYMIZED]' },
        count: type.count,
        avgRisk: Math.round(type.avgRisk || 0),
        avgResults: Math.round(type.avgResults || 0),
        lastSearch: new Date(Date.now() - i * 3600000)
      }));

      // 4. Prepare anonymized featured searches (just risk stats, no data)
      const anonymizedFeatured = Array.from({ length: 3 }, (_, i) => ({
        searchId: `featured-${i}`,
        searchType: ['email', 'username', 'image'][i],
        searchValue: '[HIDDEN]',
        summary: {
          totalResults: Math.floor(Math.random() * 150) + 50,
          criticalFindings: i === 0 ? 3 : 0,
          riskScore: [82, 74, 68][i],
          overallRisk: ['HIGH', 'HIGH', 'MEDIUM'][i]
        },
        tags: ['high-risk', 'anonymous'],
        isAnonymized: true
      }));

      // 5. Build stats object with REAL aggregates
      const stats = {
        totalSearches,
        criticalFindings: criticalCount,
        highRiskSearches: highRiskCount,
        completedSearches: completedCount,
        activeSearches: activeCount,
        last24Hours: recent24hCount,
        lastHour: recentHourCount,
        avgRiskScore: Math.round(avgRiskData[0]?.avgRisk || 0),
        riskRange: {
          min: Math.round(avgRiskData[0]?.minRisk || 0),
          max: Math.round(avgRiskData[0]?.maxRisk || 0)
        },
        avgDuration: Math.round(avgRiskData[0]?.avgDuration || 0),
        queue: queueStats
      };

      const renderData = {
        title: 'OSINT Intelligence Platform | Real Statistics',
        recentSearches: anonymizedRecentSearches, // Anonymized examples
        trendingSearches: anonymizedTrending, // Anonymized aggregates
        stats, // REAL aggregate stats (safe)
        searchTypeDistribution: typeDistribution, // REAL type distribution (safe)
        featuredSearches: anonymizedFeatured, // Anonymized examples
        aiSuggestions: [
          { 
            type: 'email', 
            icon: 'fas fa-envelope', 
            suggestion: 'Discover email leaks and associated accounts', 
            color: '#667eea',
            example: 'example@domain.com' // Example placeholder
          },
          { 
            type: 'username', 
            icon: 'fas fa-user', 
            suggestion: 'Track cross-platform digital presence', 
            color: '#764ba2',
            example: 'username123'
          },
          { 
            type: 'image', 
            icon: 'fas fa-image', 
            suggestion: 'Reverse search and AI-powered image analysis', 
            color: '#f093fb',
            example: 'profile.jpg'
          },
          { 
            type: 'phone', 
            icon: 'fas fa-phone', 
            suggestion: 'Find phone number associations and profiles', 
            color: '#4facfe',
            example: '+1 (XXX) XXX-XXXX'
          },
          { 
            type: 'name', 
            icon: 'fas fa-id-card', 
            suggestion: 'Comprehensive person search and profiling', 
            color: '#43e97b',
            example: 'John Smith'
          }
        ],
        prefill: { email: '', name: '', picture: '', username: '' },
        includeNavbar: true,
        privacyNotice: {
          enabled: true,
          title: 'Privacy Protected',
          message: 'Real aggregate statistics shown. Individual search data is never displayed.',
          icon: 'fas fa-shield-alt'
        },
        showAnonymizedData: true // Flag for template
      };

      await cache.set(cacheKey, renderData, CONFIG.CACHE.dashboard);
      
      res.render('internetSearch/dashboard', {
        ...renderData,
        nonce: res.locals.nonce,
        user: null,
        isAuthenticated: false
      });

    } catch (error) {
      logger.error(`Dashboard error: ${error.message}`, { stack: error.stack });
      
      // Fallback with minimal real data
      const fallbackStats = {
        totalSearches: await InternetSearchResult.countDocuments({}),
        activeSearches: searchQueue.getStats().running,
        queue: searchQueue.getStats()
      };
      
      const fallbackData = {
        title: 'OSINT Search Platform',
        recentSearches: [],
        trendingSearches: [],
        stats: fallbackStats,
        searchTypeDistribution: [],
        featuredSearches: [],
        aiSuggestions: [],
        prefill: {},
        includeNavbar: true,
        privacyNotice: {
          enabled: true,
          title: 'Live Statistics',
          message: 'Showing real-time aggregate data. Individual searches remain private.',
          icon: 'fas fa-chart-line'
        },
        showAnonymizedData: false
      };
      
      res.render('internetSearch/dashboard', {
        ...fallbackData,
        nonce: res.locals.nonce,
        user: null,
        isAuthenticated: false
      });
    }
  })
);



// ==================== START SEARCH ====================

router.post('/start',
  rateLimiter(CONFIG.RATE_LIMITS.search),
  wrapAsync(async (req, res) => {
    try {
      const { searchType, searchValue, searchOptions = {}, webhookUrl } = req.body;
      
      // 🔍 DEBUG LOGGING
      logger.info('POST /start request:', {
        searchType,
        searchValue: searchValue?.substring(0, 150),
        valueLength: searchValue?.length,
        valueType: typeof searchValue,
        ip: req.ip
      });
      
      // Validation
      if (!searchType || !searchValue) {
        logger.warn('Validation failed: missing fields');
        return res.status(400).json({ success: false, message: 'Type and value required' });
      }

      const validTypes = ['email', 'name', 'username', 'phone', 'image'];
      if (!validTypes.includes(searchType)) {
        return res.status(400).json({ success: false, message: `Invalid type: ${validTypes.join(', ')}` });
      }

      const validator = validators[searchType];

      if (!validator) {
        logger.error('No validator found', { searchType });
        return res.status(400).json({ 
          success: false, 
          message: `No validator for type: ${searchType}` 
        });
      }

      logger.debug('Running validator', { searchType, valuePreview: searchValue.substring(0, 50) });

      const isValid = validator(searchValue);

      logger.info('Validation result', { searchType, isValid });

      if (!isValid) {
        logger.warn('Validation rejected value', { 
          searchType, 
          value: searchValue.substring(0, 150) 
        });
        
        return res.status(400).json({ 
          success: false, 
          message: `Invalid ${searchType} format`,
          debug: {  // Include debug info in response
            receivedValue: searchValue.substring(0, 100),
            valueLength: searchValue.length
          }
        });
      }

      logger.info('Validation passed, proceeding with search');

      // Duplicate check
      const duplicate = await InternetSearchResult.findOne({
        searchType,
        searchValue,
        status: 'running',
        createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
      });

      if (duplicate) {
        return res.json({
          success: true,
          message: 'Search in progress',
          searchId: duplicate.searchId,
          redirect: `/internet-search/results/${duplicate.searchId}`,
          queuePosition: searchQueue.getPosition(duplicate.searchId)
        });
      }

      const searchId = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`;
      
      logger.info(`Starting search: ${searchType}=${searchValue}`, { 
        searchId, 
        ip: req.ip,
        options: searchOptions 
      });

      metrics.increment('search.started', 1, { type: searchType });

      // Create search record - SINGLE METADATA OBJECT
      const searchResult = new InternetSearchResult({
        searchId,
        userId: null,
        searchType,
        searchValue,
        isPrivate: true, // Don't show in public lists
        expiresAt: new Date(Date.now() + CONFIG.SEARCH.EPHEMERAL_TTL), // e.g., 24 hours
        
        // SINGLE metadata object combining everything
        metadata: {
          ephemeral: true,
          sessionId: req.sessionID,
          ipHash: crypto.createHash('sha256').update(req.ip).digest('hex'),
          userAgent: req.headers['user-agent'],
          accessed: 0, // Track how many times accessed
          ip: req.ip,
          country: req.headers['cf-ipcountry'] || 'Unknown',
          language: req.headers['accept-language']?.split(',')[0] || 'en',
          queuedAt: new Date(),
          // Progress tracking fields (will be updated during search)
          lastProgress: 0,
          lastPhase: 'initializing',
          lastMessage: 'Starting search...',
          progressHistory: []
        },
        
        startTime: new Date(),
        status: 'queued',
        isPublic: false, // Set to false for privacy
        searchOptions: {
          deepSearch: searchOptions.deepSearch || false,
          includeBreaches: searchOptions.includeBreaches !== false,
          includeSocial: searchOptions.includeSocial !== false,
          includeDarkWeb: searchOptions.includeDarkWeb || false,
          aiAnalysis: searchOptions.aiAnalysis !== false,
          priority: searchOptions.priority || 5
        },
        sources: {},
        summary: {
          totalResults: 0,
          criticalFindings: 0,
          moderateFindings: 0,
          lowRiskFindings: 0,
          riskScore: 0,
          overallRisk: 'LOW'
        },
        tags: ['ephemeral', searchType] // Add tags for easier filtering
      });

      await searchResult.save();

      // Register webhook
      if (webhookUrl && /^https?:\/\/.+/.test(webhookUrl)) {
        webhookManager.register(searchId, webhookUrl);
      }

      // Queue search
      const priority = searchOptions.priority || 5;
      await searchQueue.add(searchId, async () => {
        await executeSearch(searchId, searchType, searchValue, searchOptions, req);
      }, priority);

      const queuePosition = searchQueue.getPosition(searchId);

      res.json({
        success: true,
        message: 'Search queued successfully',
        searchId,
        redirect: `/internet-search/results/${searchId}`,
        queuePosition,
        queueStats: searchQueue.getStats(),
        estimatedTime: queuePosition ? `${queuePosition * 90}s` : '60-120s',
        privacyNote: 'Search results will be automatically deleted after 24 hours.'
      });

    } catch (error) {
      logger.error(`Start search error: ${error.message}`, { ip: req.ip, stack: error.stack });
      metrics.increment('search.start.errors');

      res.status(500).json({
        success: false,
        message: 'Failed to start search',
        retryable: true
      });
    }
  })
);

// ==================== SEARCH EXECUTION ====================

async function executeSearch(searchId, searchType, searchValue, searchOptions, req) {
  try {
    await InternetSearchResult.updateOne(
      { searchId },
      { $set: { status: 'running', 'metadata.startedAt': new Date() } }
    );

    const io = req.app.get('socketio');
    const roomId = req.sessionID || req.ip;

    const progressCallback = async (update) => {
      const progressUpdate = {
        searchId,
        ...update,
        timestamp: new Date().toISOString(),
        estimatedRemaining: Math.round((100 - update.progress) * 1.5)
      };

      io.to(roomId).emit('search_progress', progressUpdate);

      await InternetSearchResult.updateOne(
        { searchId },
        {
          $set: {
            'metadata.lastProgress': update.progress,
            'metadata.lastPhase': update.phase,
            'metadata.lastMessage': update.message,
            'metadata.lastUpdate': new Date()
          },
          $push: {
            'metadata.progressHistory': {
              $each: [{ ...update, timestamp: new Date() }],
              $slice: -20
            }
          },
          $inc: { 'metadata.accessed': 1 } // Track views
        }
      );
    };

    const results = await InternetSearchOrchestrator.executeComprehensiveSearch(
      { 
        type: searchType, 
        value: searchValue, 
        ip: req.ip,
        options: searchOptions
      },
      progressCallback
    );

    const enhancedSummary = {
      ...results.summary,
      dataFreshness: 100,
      completeness: Math.min(100, Math.round((results.summary.totalResults / 10) * 100)),
      confidence: results.summary.totalResults > 50 ? 'HIGH' : 
                 results.summary.totalResults > 20 ? 'MEDIUM' : 'LOW'
    };

    const tags = analytics.generateTags(searchType, results);

    await InternetSearchResult.updateOne(
      { searchId },
      {
        $set: {
          sources: results.sources,
          summary: enhancedSummary,
          aiProfile: results.aiProfile,
          status: results.status,
          endTime: results.endTime,
          duration: results.duration,
          error: results.error,
          tags,
          'metadata.completedAt': new Date()
        }
      }
    );

    io.to(roomId).emit('search_complete', {
      searchId,
      status: results.status,
      summary: enhancedSummary,
      hasAiProfile: !!results.aiProfile,
      hasCriticalFindings: enhancedSummary.criticalFindings > 0
    });

    webhookManager.trigger(searchId, 'complete', { summary: enhancedSummary });

    logger.info(`Search completed: ${searchId}`, {
      duration: results.duration,
      totalResults: enhancedSummary.totalResults,
      riskScore: enhancedSummary.riskScore
    });

    metrics.increment('search.completed', 1, { type: searchType });
    metrics.timing('search.duration', results.duration);

  } catch (error) {
    logger.error(`Search execution error: ${searchId}`, { error: error.stack });

    await InternetSearchResult.updateOne(
      { searchId },
      {
        $set: {
          status: 'error',
          error: { message: error.message, code: error.code },
          endTime: new Date()
        }
      }
    );

    const io = req.app.get('socketio');
    io.to(req.sessionID || req.ip).emit('search_error', {
      searchId,
      error: 'Search failed',
      retryable: true
    });

    webhookManager.trigger(searchId, 'error', { error: error.message });

    metrics.increment('search.errors');
  }
}

// ==================== RESULTS PAGE ====================

router.get('/results/:searchId',
  rateLimiter(CONFIG.RATE_LIMITS.dashboard),
  wrapAsync(async (req, res) => {
    try {
      const { searchId } = req.params;
      
      const searchResult = await InternetSearchResult.findOneAndUpdate(
        { searchId },
        { $inc: { 'metrics.viewCount': 1 } },
        { new: true }
      );

      if (!searchResult) {
        return res.status(404).render('error', {
          err: { status: 404, message: 'Search not found or expired' },
          title: 'Not Found',
          nonce: res.locals.nonce,
          redirectUrl: '/internet-search'
        });
      }

      const [relatedSearches, typeStats] = await Promise.all([
        InternetSearchResult.find({
          searchType: searchResult.searchType,
          searchId: { $ne: searchId },
          isPublic: true,
          status: 'complete'
        })
        .limit(8)
        .select('searchId searchType searchValue summary createdAt tags')
        .lean(),
        
        InternetSearchResult.aggregate([
          { $match: { 
            searchType: searchResult.searchType,
            isPublic: true,
            status: 'complete'
          }},
          { $group: {
            _id: null,
            avgRisk: { $avg: '$summary.riskScore' },
            avgResults: { $avg: '$summary.totalResults' },
            totalSearches: { $sum: 1 }
          }}
        ])
      ]);

      const analyticsData = {
        uniqueness: analytics.calculateUniqueness(searchResult),
        completeness: analytics.calculateCompleteness(searchResult),
        dataFreshness: analytics.calculateDataFreshness(searchResult),
        impactScore: analytics.calculateImpact(searchResult.summary),
        confidence: analytics.calculateConfidence(searchResult)
      };

      const aiInsights = analytics.generateInsights(searchResult);

      res.render('internetSearch/results', {
        title: `OSINT Results: ${searchResult.searchType.toUpperCase()} | VisiSocial`,
        searchResult,
        analytics: analyticsData,
        relatedSearches,
        aiInsights,
        comparisonStats: typeStats[0] || { avgRisk: 0, avgResults: 0, totalSearches: 0 },
        user: null,
        nonce: res.locals.nonce,
        isAuthenticated: false,
        isOwner: false,
        showSharing: true,
        showExport: true,
        canonicalUrl: `${req.protocol}://${req.get('host')}/internet-search/results/${searchId}`
      });

    } catch (error) {
      logger.error(`Results error: ${error.message}`, { searchId: req.params.searchId });
      res.status(500).render('error', {
        err: { status: 500, message: 'Error loading results' },
        title: 'Error',
        nonce: res.locals.nonce,
        redirectUrl: '/internet-search'
      });
    }
  })
);

// ==================== API ENDPOINTS ====================

router.get('/api/status/:searchId',
  wrapAsync(async (req, res) => {
    const searchResult = await InternetSearchResult.findOne({ searchId: req.params.searchId });
    
    if (!searchResult) {
      return res.status(404).json({ success: false, message: 'Search not found' });
    }

    res.json({
      success: true,
      search: {
        searchId: searchResult.searchId,
        status: searchResult.status,
        progress: searchResult.metadata?.lastProgress || 0,
        phase: searchResult.metadata?.lastPhase || 'initializing',
        message: searchResult.metadata?.lastMessage || 'Starting...',
        queuePosition: searchQueue.getPosition(searchResult.searchId),
        summary: searchResult.summary,
        startTime: searchResult.startTime,
        endTime: searchResult.endTime,
        duration: searchResult.duration
      }
    });
  })
);

router.get('/api/queue/stats',
  wrapAsync(async (req, res) => {
    res.json({
      success: true,
      queue: searchQueue.getStats(),
      timestamp: new Date().toISOString()
    });
  })
);

// ==================== EXPORT ====================

router.get('/export/:searchId/:format?',
  rateLimiter(CONFIG.RATE_LIMITS.export),
  wrapAsync(async (req, res) => {
    const { searchId, format = 'json' } = req.params;
    
    const searchResult = await InternetSearchResult.findOne({ searchId });
    
    if (!searchResult) {
      return res.status(404).json({ success: false, message: 'Search not found' });
    }

    await InternetSearchResult.updateOne({ searchId }, { $inc: { 'metrics.exportCount': 1 } });

    const exportData = {
      metadata: {
        searchId: searchResult.searchId,
        searchType: searchResult.searchType,
        searchValue: searchResult.searchValue,
        createdAt: searchResult.createdAt,
        duration: searchResult.duration,
        version: '4.0.0'
      },
      summary: searchResult.summary,
      sources: searchResult.sources,
      aiProfile: searchResult.aiProfile,
      analytics: {
        uniqueness: analytics.calculateUniqueness(searchResult),
        completeness: analytics.calculateCompleteness(searchResult),
        confidence: analytics.calculateConfidence(searchResult),
        dataFreshness: analytics.calculateDataFreshness(searchResult)
      }
    };

    const exporter = exporters[format.toLowerCase()];
    if (!exporter) {
      return res.status(400).json({ success: false, message: 'Invalid format: json, txt, csv, html' });
    }

    const contentTypes = {
      json: 'application/json',
      txt: 'text/plain',
      csv: 'text/csv',
      html: 'text/html'
    };

    res.setHeader('Content-Type', contentTypes[format] || 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="osint-${searchId}.${format}"`);
    res.send(exporter(exportData));

    metrics.increment('export.success', 1, { format });
  })
);

// ==================== ANALYTICS ====================

router.get('/analytics/global',
  rateLimiter(CONFIG.RATE_LIMITS.api),
  wrapAsync(async (req, res) => {
    const cacheKey = 'analytics:global';
    const cached = await cache.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const [typeDistribution, riskDistribution, timeSeries, topSearches] = await Promise.all([
      InternetSearchResult.aggregate([
        { $match: { isPublic: true } },
        { $group: {
          _id: '$searchType',
          count: { $sum: 1 },
          avgRisk: { $avg: '$summary.riskScore' },
          avgResults: { $avg: '$summary.totalResults' },
          avgDuration: { $avg: '$duration' }
        }},
        { $sort: { count: -1 } }
      ]),
      
      InternetSearchResult.aggregate([
        { $match: { isPublic: true, status: 'complete' } },
        { $group: {
          _id: '$summary.overallRisk',
          count: { $sum: 1 }
        }}
      ]),
      
      InternetSearchResult.aggregate([
        { $match: { 
          isPublic: true,
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }},
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          avgRisk: { $avg: '$summary.riskScore' }
        }},
        { $sort: { '_id': 1 } }
      ]),
      
      InternetSearchResult.find({ isPublic: true, status: 'complete' })
        .sort({ 'summary.riskScore': -1 })
        .limit(10)
        .select('searchType searchValue summary.riskScore tags')
        .lean()
    ]);

    const result = {
      success: true,
      analytics: {
        typeDistribution,
        riskDistribution,
        timeSeries,
        topSearches,
        totals: {
          searches: await InternetSearchResult.countDocuments({ isPublic: true }),
          completed: await InternetSearchResult.countDocuments({ isPublic: true, status: 'complete' }),
          active: await InternetSearchResult.countDocuments({ isPublic: true, status: 'running' })
        },
        queue: searchQueue.getStats()
      },
      timestamp: new Date().toISOString()
    };

    await cache.set(cacheKey, result, CONFIG.CACHE.stats);
    res.json(result);
  })
);


// ====================== Test validators ====================

router.post('/test-validate', wrapAsync(async (req, res) => {
  const { searchType, searchValue } = req.body;
  
  const validator = validators[searchType];
  if (!validator) {
    return res.json({
      success: false,
      error: 'No validator for type',
      searchType
    });
  }
  
  const isValid = validator(searchValue);
  
  res.json({
    success: true,
    searchType,
    searchValue: searchValue.substring(0, 150),
    isValid,
    validatorExists: !!validator,
    checks: {
      hasUploads: searchValue.includes('/uploads/'),
      hasImageExt: ['.jpg', '.jpeg', '.png'].some(ext => 
        searchValue.toLowerCase().endsWith(ext)
      ),
      startsWithData: searchValue.startsWith('data:image/'),
      isLocalhost: searchValue.includes('localhost')
    }
  });
}));


// ==================== CLEANUP ====================

async function cleanup() {
  try {
    const now = new Date();
    
    // 1. Delete searches older than TTL (existing logic)
    const cutoff = new Date(now.getTime() - CONFIG.SEARCH.RESULT_TTL);
    
    const oldSearches = await InternetSearchResult.find({
      $or: [
        // Old searches (keep existing logic)
        { createdAt: { $lt: cutoff }, isPublicDemo: { $ne: true } },
        // NEW: Ephemeral searches that have expired
        { expiresAt: { $lt: now, $exists: true } }
      ]
    }).select('searchId searchType searchValue expiresAt createdAt');

    let deletedCount = 0;
    let imageFilesDeleted = 0;

    for (const search of oldSearches) {
      // Delete image files (existing logic)
      if (search.searchType === 'image' && search.searchValue?.includes('/uploads/')) {
        const filename = search.searchValue.split('/uploads/images/')[1];
        if (filename) {
          const basePath = path.join(__dirname, '../public/uploads/images', filename);
          const paths = [
            basePath, 
            basePath.replace(/(\.[^.]+)$/, '-optimized$1'), 
            basePath.replace(/(\.[^.]+)$/, '-thumb$1')
          ];
          
          for (const p of paths) {
            try {
              if (fsSync.existsSync(p)) {
                await fs.unlink(p);
                imageFilesDeleted++;
              }
            } catch (err) {
              logger.warn(`Cleanup file error: ${err.message}`);
            }
          }
        }
      }
      
      deletedCount++;
    }

    // Delete the expired searches from database
    const result = await InternetSearchResult.deleteMany({
      _id: { $in: oldSearches.map(s => s._id) }
    });

    logger.info(`Cleanup: ${result.deletedCount} searches removed`, {
      expired: oldSearches.filter(s => s.expiresAt).length,
      old: oldSearches.filter(s => !s.expiresAt).length,
      imageFilesDeleted,
      totalDeleted: result.deletedCount
    });

    metrics.increment('cleanup.executed', result.deletedCount);
    metrics.gauge('cleanup.files_deleted', imageFilesDeleted);

    // Optional: Clean orphaned image files (safety net)
    await cleanupOrphanedImages();

  } catch (error) {
    logger.error(`Cleanup error: ${error.message}`, { stack: error.stack });
  }
}

// Optional: Clean up orphaned image files
async function cleanupOrphanedImages() {
  try {
    const uploadsDir = path.join(__dirname, '../public/uploads/images');
    
    if (!fsSync.existsSync(uploadsDir)) return;
    
    // Get all image files in uploads
    const files = await fs.readdir(uploadsDir, { recursive: true });
    const imageFiles = files.filter(f => 
      /\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i.test(f)
    );
    
    // Find all image references in database
    const dbImages = await InternetSearchResult.distinct('searchValue', {
      searchType: 'image',
      searchValue: { $regex: '/uploads/images/' }
    });
    
    const dbImageNames = dbImages.map(img => {
      const parts = img.split('/');
      return parts[parts.length - 1];
    });
    
    // Delete files not referenced in database
    let orphanedDeleted = 0;
    for (const file of imageFiles) {
      const filename = path.basename(file);
      const isReferenced = dbImageNames.some(dbFile => 
        dbFile.includes(filename.replace('-optimized', '').replace('-thumb', ''))
      );
      
      if (!isReferenced) {
        const filePath = path.join(uploadsDir, file);
        try {
          await fs.unlink(filePath);
          orphanedDeleted++;
          logger.debug(`Deleted orphaned image: ${file}`);
        } catch (err) {
          logger.warn(`Failed to delete orphaned image ${file}: ${err.message}`);
        }
      }
    }
    
    if (orphanedDeleted > 0) {
      logger.info(`Cleaned ${orphanedDeleted} orphaned image files`);
    }
    
  } catch (error) {
    logger.error(`Orphaned images cleanup error: ${error.message}`);
  }
}

// More frequent cleanup for ephemeral searches (e.g., every hour)
setInterval(cleanup, 60 * 60 * 1000); // Every hour 

// Also run on startup
cleanup();

module.exports = router;