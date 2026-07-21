/**
 * InternetSearchResult.js - Enhanced OSINT Search Results Model
 * @version 4.0.0 - Ultra Enhanced Production System
 * @description Store comprehensive OSINT search results with AI profiling, queue management, and advanced analytics
 */

const mongoose = require('mongoose');

const internetSearchResultSchema = new mongoose.Schema({
  // Search metadata
  searchId: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  
  userId: {
    type: String,
    required: false,
    index: true,
    default: null
  },
  
  searchType: {
    type: String,
    required: true,
    enum: ['email', 'name', 'username', 'phone', 'image'],
    index: true
  },
  
  searchValue: {
    type: String,
    required: true,
    index: true
  },
  
  // Timestamps
  startTime: {
    type: Date,
    required: true,
    default: Date.now
  },
  
  endTime: {
    type: Date
  },
  
  duration: {
    type: Number // milliseconds
  },
  
  // Results
  sources: {
    searchEngines: [{
      title: String,
      url: String,
      snippet: String,
      source: String,
      displayLink: String,
      thumbnail: String,
      riskLevel: String,
      riskReason: String,
      timestamp: Date
    }],
    
    breaches: [{
      name: String,
      title: String,
      domain: String,
      breachDate: String,
      pwnCount: Number,
      description: String,
      dataClasses: [String],
      isVerified: Boolean,
      source: String
    }],
    
    pastes: [{
      source: String,
      id: String,
      title: String,
      date: String,
      emailCount: Number
    }],
    
    socialMedia: [{
      platform: String,
      searchUrl: String,
      profileUrl: String,
      username: String,
      description: String,
      icon: String,
      color: String,
      verified: Boolean,
      status: String,
      additionalData: {
        followers: Number,
        repos: Number,
        karma: Number,
        posts: Number
      },
      requiresManualCheck: Boolean
    }],
    
    codeRepositories: [{
      platform: String,
      url: String,
      description: String,
      icon: String,
      requiresManualCheck: Boolean
    }],
    
    pasteSites: [{
      site: String,
      url: String,
      description: String,
      riskLevel: String,
      reason: String
    }],
    
    reverseImageLinks: [{
      engine: String,
      url: String,
      description: String,
      priority: String,
      note: String
    }],
    
    professionalNetworks: [{
      network: String,
      url: String,
      description: String,
      icon: String
    }],
    
    publicRecords: [{
      service: String,
      url: String,
      type: String,
      description: String
    }],
    
    // Image analysis fields
    imageAnalysis: {
      fullAnalysis: String,
      timestamp: Date,
      confidence: String,
      error: String
    },
    
    imageMetadata: {
      contentType: String,
      contentLength: Number,
      lastModified: String,
      server: String,
      accessible: Boolean,
      error: String
    },

    // Infrastructure exposure (Shodan)
    infrastructure: {
      target: String,
      targetType: String,        // 'ip' | 'domain'
      resolvedIp: String,
      org: String,
      isp: String,
      os: String,
      location: String,
      hostnames: [String],
      tags: [String],
      software: [String],
      totalHosts: Number,
      ports: [Number],
      vulns: [String],
      services: [{
        ip: String,
        port: Number,
        transport: String,
        product: String,
        version: String,
        org: String,
        hostnames: [String],
        cpe: [String]
      }]
    }
  },
  
  // Summary with enhanced stats
  summary: {
    totalResults: {
      type: Number,
      default: 0
    },
    
    criticalFindings: {
      type: Number,
      default: 0
    },
    
    moderateFindings: {
      type: Number,
      default: 0
    },
    
    lowRiskFindings: {
      type: Number,
      default: 0
    },
    
    riskScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    
    overallRisk: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'LOW'
    },
    
    // Enhanced summary fields
    socialMediaStats: {
      verified: { type: Number, default: 0 },
      unknown: { type: Number, default: 0 },
      searchOnly: { type: Number, default: 0 }
    },
    
    dataFreshness: {
      type: Number,
      min: 0,
      max: 100,
      default: 100
    },
    
    completeness: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    
    confidence: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'MEDIUM'
    }
  },
  
  // AI-generated profile
  aiProfile: {
    fullProfile: String,
    generatedAt: Date,
    model: String,
    tokensUsed: Number,
    confidence: String,
    error: String
  },
  
  // Status - FIXED: Added 'queued'
  status: {
    type: String,
    enum: ['pending', 'queued', 'running', 'complete', 'error'],
    default: 'pending',
    index: true
  },
  
  error: {
    message: String,
    code: String,
    timestamp: Date
  },
  
  // Search options
  searchOptions: {
    deepSearch: { type: Boolean, default: false },
    includeBreaches: { type: Boolean, default: true },
    includeSocial: { type: Boolean, default: true },
    includeDarkWeb: { type: Boolean, default: false },
    aiAnalysis: { type: Boolean, default: true },
    priority: { type: Number, default: 5, min: 1, max: 10 }
  },
  
  // Enhanced metadata
  metadata: {
    // Progress tracking
    lastProgress: { type: Number, min: 0, max: 100, default: 0 },
    lastPhase: String,
    lastMessage: String,
    lastUpdate: Date,
    progressHistory: [{
      phase: String,
      progress: Number,
      message: String,
      timestamp: Date
    }],
    
    // Queue info
    queuedAt: Date,
    startedAt: Date,
    completedAt: Date,
    
    // Request metadata
    userAgent: String,
    ip: String,
    sessionId: String,
    country: String,
    language: String
  },
  
  // Metrics
  metrics: {
    viewCount: { type: Number, default: 0 },
    exportCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },
    lastViewed: Date,
    lastExported: Date
  },
  
  // Tags for categorization
  tags: [String],
  
  // Public visibility
  isPublic: {
    type: Boolean,
    default: true
  },
  
  isPublicDemo: {
    type: Boolean,
    default: false
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound indexes for efficient querying
internetSearchResultSchema.index({ userId: 1, createdAt: -1 });
internetSearchResultSchema.index({ searchType: 1, searchValue: 1 });
internetSearchResultSchema.index({ 'summary.overallRisk': 1, createdAt: -1 });
internetSearchResultSchema.index({ status: 1, createdAt: -1 });
internetSearchResultSchema.index({ isPublic: 1, status: 1, createdAt: -1 });
internetSearchResultSchema.index({ tags: 1 });
internetSearchResultSchema.index({ 'metadata.queuedAt': 1 });

// Text search index
internetSearchResultSchema.index({ 
  searchValue: 'text',
  'sources.searchEngines.title': 'text',
  'sources.searchEngines.snippet': 'text'
});

// Update timestamp on save
internetSearchResultSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Virtual for duration in seconds
internetSearchResultSchema.virtual('durationSeconds').get(function() {
  return this.duration ? Math.round(this.duration / 1000) : 0;
});

// Virtual for age in days
internetSearchResultSchema.virtual('ageInDays').get(function() {
  return Math.floor((Date.now() - this.createdAt.getTime()) / (1000 * 60 * 60 * 24));
});

// Instance method to check if search is stale
internetSearchResultSchema.methods.isStale = function() {
  const staleThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days
  return Date.now() - this.createdAt.getTime() > staleThreshold;
};

// Instance method to calculate completion percentage
internetSearchResultSchema.methods.getCompletionPercentage = function() {
  if (this.status === 'complete') return 100;
  if (this.status === 'error') return 0;
  return this.metadata?.lastProgress || 0;
};

// Static method to get active searches
internetSearchResultSchema.statics.getActiveSearches = function() {
  return this.find({
    status: { $in: ['queued', 'running'] }
  }).sort({ 'metadata.queuedAt': 1 });
};

// Static method to get statistics
internetSearchResultSchema.statics.getStatistics = async function(timeRange = 24 * 60 * 60 * 1000) {
  const since = new Date(Date.now() - timeRange);
  
  const [total, completed, active, avgRisk] = await Promise.all([
    this.countDocuments({ isPublic: true }),
    this.countDocuments({ isPublic: true, status: 'complete' }),
    this.countDocuments({ isPublic: true, status: { $in: ['queued', 'running'] } }),
    this.aggregate([
      { $match: { isPublic: true, status: 'complete' } },
      { $group: { _id: null, avgRisk: { $avg: '$summary.riskScore' } } }
    ])
  ]);
  
  return {
    totalSearches: total,
    completedSearches: completed,
    activeSearches: active,
    avgRiskScore: Math.round(avgRisk[0]?.avgRisk || 0)
  };
};

// Enable virtuals in JSON
internetSearchResultSchema.set('toJSON', { virtuals: true });
internetSearchResultSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('InternetSearchResult', internetSearchResultSchema);
