/**
 * routes/surveillanceRoutes.js
 * @version 6.0.0 - "VisiSocial"
 * @author Enhanced System
 * @license MIT
 * 
 * Complete real-time surveillance with comprehensive Facebook data monitoring,
 * behavioral analytics, threat intelligence, and exploitation scenarios.
 */

const express = require('express');
const router = express.Router();
const moment = require('moment');
const crypto = require('crypto');
const User = require('../models/User');
const wrapAsync = require('../utils/wrapAsync');
const logger = require('../utils/logger');
const SurveillanceEngine = require('../services/surveillanceEngine');
const { generatePersonalityDescription, generateUserDataDescription, generateUserInsights } = require('./homeRoute');

// Middleware
const { authenticateToken } = require('./homeRoute');

// ==================== ENHANCED REAL-TIME DATA STORES ====================
const realTimeUserData = new Map(); // userId → comprehensive Facebook monitoring data

// ==================== COMPREHENSIVE FACEBOOK DATA ANALYSIS ====================

/**
 * Analyze Facebook data with deep surveillance insights
 */
async function analyzeFacebookDataComprehensive(userId) {
  try {
    const user = await User.findOne({ id: userId });
    if (!user) {
      logger.warn(`User ${userId} not found for Facebook analysis`);
      return null;
    }

    // ==================== 1. BASIC PROFILE ANALYSIS ====================
    const profileData = {
      // Identity Information
      identity: {
        name: user.name,
        email: user.email,
        gender: user.gender,
        birthday: user.birthday,
        age_range: user.age_range,
        profilePicture: user.picture,
        
        // Location Intelligence
        currentLocation: user.location,
        hometown: user.hometown,
        languages: user.languages || [],
        
        // Network Statistics
        friendCount: user.friends?.length || 0,
        joinedDate: user.createdAt,
        lastUpdated: user.lastUpdated
      },
      
      // ==================== 2. CONTENT ANALYSIS ====================
      content: {
        posts: {
          count: user.feedData?.length || 0,
          recent: user.feedData?.slice(-10) || [],
          averageLength: calculateAveragePostLength(user.feedData),
          sentiment: user.sentimentResult || {},
          mostCommonTopics: extractTopicsFromPosts(user.feedData || [])
        },
        
        likes: {
          count: user.likes?.length || 0,
          categories: categorizeLikes(user.likes || []),
          frequencyByCategory: calculateLikeFrequency(user.likes || []),
          engagementPatterns: analyzeLikePatterns(user.likes || [])
        },
        
        images: {
          albumCount: user.albumsData?.length || 0,
          processedPhotos: user.processedAlbums?.reduce((sum, album) => sum + album.processedPhotos, 0) || 0,
          albums: user.albumsData || [],
          extractedText: countExtractedText(user.processedAlbums || []),
          ocrConfidence: calculateAverageOCRConfidence(user.processedAlbums || [])
        }
      },
      
      // ==================== 3. BEHAVIORAL PATTERNS ====================
      behavioral: {
        engagementScore: user.engagementScore || 0,
        postingRhythms: analyzePostingRhythms(user.feedData || []),
        activityHours: calculateActiveHours(user.feedData || []),
        interactionFrequency: calculateInteractionFrequency(user),
        contentTypePreferences: analyzeContentTypePreferences(user)
      },
      
      // ==================== 4. PERSONALITY & PSYCHOLOGICAL INSIGHTS ====================
      psychological: {
        personalityScores: user.personalityScores || {},
        personalityDescription: user.pD || '',
        areaOfInterest: user.areaOfInterest || 'General',
        interestDiversity: user.interestDiversity || 0,
        mostCommonLikes: user.mostCommonLikes || '',
        vocabulary: {
          mostCommonWords: user.mostCommonWords || [],
          uniqueWords: user.textStatistics?.uniqueWords || 0,
          vocabularyDiversity: user.textStatistics?.vocabularyDiversity || 0,
          readability: user.readability || {}
        }
      },
      
      // ==================== 5. SURVEILLANCE SPECIFICS ====================
      surveillance: user.surveillance || {
        behavioralPatterns: {},
        inferredTraits: {},
        lifestyleMarkers: {},
        vulnerabilityProfile: {}
      },
      
      // ==================== 6. DATA METRICS ====================
      metrics: {
        dataPoints: calculateTotalDataPoints(user),
        dataFreshness: calculateDataFreshness(user),
        analysisConfidence: calculateAnalysisConfidence(user),
        profileCompleteness: calculateProfileCompleteness(user)
      }
    };

    // ==================== 7. EXPLOITATION SCENARIOS ====================
    profileData.exploitationScenarios = calculateExploitationScenarios(profileData);
    
    // ==================== 8. PRIVACY RISK ASSESSMENT ====================
    profileData.privacyRisk = calculatePrivacyRiskAssessment(profileData);
    
    // ==================== 9. ENTITY VIEWS ====================
    profileData.entityViews = calculateEntityViews(profileData);
    
    // ==================== 10. TEMPORAL ANALYSIS ====================
    profileData.temporalAnalysis = analyzeTemporalPatterns(user);
    
    // ==================== 11. CROSS-PLATFORM CORRELATION POTENTIAL ====================
    profileData.correlationPotential = assessCrossPlatformCorrelation(user);
    
    // ==================== 12. ENSURE TEMPLATE-COMPATIBLE DATA STRUCTURE ====================
    profileData.metrics = {
      ...profileData.metrics,
      // Ensure dataPoints has the structure the template expects
      dataPoints: {
        ...profileData.metrics.dataPoints,
        // Add template-compatible structure
        explicit: profileData.metrics.dataPoints?.explicit || {
          profileFields: 0,
          posts: 0,
          likes: 0,
          albums: 0,
          processedPhotos: 0
        },
        implicit: profileData.metrics.dataPoints?.implicit || {
          behavioralPatterns: 0,
          inferredTraits: 0,
          lifestyleMarkers: 0,
          correlations: 0
        },
        // Template expects 'detailed' structure
        detailed: {
          profileInfo: profileData.metrics.dataPoints?.explicit?.profileFields || 0
        },
        total: profileData.metrics.dataPoints?.total || 0
      }
    };
    
    profileData.analysisTimestamp = new Date();
    profileData.userId = userId;
    
    return profileData;
  } catch (error) {
    logger.error(`Comprehensive Facebook analysis failed: ${error.message}`);
    return null;
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate average post length
 */
function calculateAveragePostLength(feedData) {
  if (!feedData || !Array.isArray(feedData)) return 0;
  
  const postsWithText = feedData.filter(post => {
    const text = post.message || post.text || '';
    return text && text.trim().length > 0;
  });
  
  if (postsWithText.length === 0) return 0;
  
  const totalLength = postsWithText.reduce((sum, post) => {
    const text = post.message || post.text || '';
    return sum + text.length;
  }, 0);
  
  return Math.round(totalLength / postsWithText.length);
}

/**
 * Extract topics from posts
 */
function extractTopicsFromPosts(feedData) {
  const topics = {};
  const topicKeywords = {
    travel: ['travel', 'trip', 'vacation', 'flight', 'hotel', 'destination'],
    food: ['food', 'restaurant', 'dinner', 'lunch', 'breakfast', 'cooking', 'recipe'],
    entertainment: ['movie', 'music', 'show', 'concert', 'game', 'sport', 'tv'],
    technology: ['tech', 'phone', 'computer', 'software', 'app', 'internet', 'ai'],
    fitness: ['gym', 'workout', 'exercise', 'fitness', 'health', 'running', 'yoga'],
    family: ['family', 'kids', 'parents', 'children', 'baby', 'son', 'daughter'],
    work: ['work', 'job', 'office', 'career', 'project', 'meeting', 'business']
  };
  
  feedData.forEach(post => {
    const text = (post.message || post.text || '').toLowerCase();
    Object.entries(topicKeywords).forEach(([topic, keywords]) => {
      if (keywords.some(keyword => text.includes(keyword))) {
        topics[topic] = (topics[topic] || 0) + 1;
      }
    });
  });
  
  return Object.entries(topics)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));
}

/**
 * Categorize likes
 */
function categorizeLikes(likes) {
  const categories = {
    entertainment: ['movie', 'tv', 'music', 'celebrity', 'show', 'artist', 'band'],
    brands: ['nike', 'apple', 'starbucks', 'coca-cola', 'adidas', 'samsung'],
    food: ['restaurant', 'food', 'recipe', 'chef', 'coffee', 'baking'],
    sports: ['sport', 'team', 'athlete', 'game', 'league', 'fitness'],
    news: ['news', 'media', 'newspaper', 'magazine', 'blog'],
    education: ['university', 'college', 'school', 'education', 'learning'],
    technology: ['tech', 'software', 'gadget', 'app', 'website', 'internet'],
    places: ['city', 'country', 'place', 'landmark', 'location', 'venue']
  };
  
  const categoryCounts = {};
  
  likes.forEach(like => {
    const name = (like.name || '').toLowerCase();
    let categorized = false;
    
    Object.entries(categories).forEach(([category, keywords]) => {
      if (keywords.some(keyword => name.includes(keyword))) {
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        categorized = true;
      }
    });
    
    if (!categorized) {
      categoryCounts['other'] = (categoryCounts['other'] || 0) + 1;
    }
  });
  
  return Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));
}

/**
 * Calculate like frequency by category
 */
function calculateLikeFrequency(likes) {
  const frequency = {};
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  likes.forEach(like => {
    if (like.created_time) {
      const date = new Date(like.created_time);
      const month = monthNames[date.getMonth()];
      const year = date.getFullYear();
      const key = `${month} ${year}`;
      
      frequency[key] = (frequency[key] || 0) + 1;
    }
  });
  
  return Object.entries(frequency)
    .sort((a, b) => {
      const [monthA, yearA] = a[0].split(' ');
      const [monthB, yearB] = b[0].split(' ');
      const dateA = new Date(`${monthA} 1, ${yearA}`);
      const dateB = new Date(`${monthB} 1, ${yearB}`);
      return dateA - dateB;
    });
}

/**
 * Analyze like patterns
 */
function analyzeLikePatterns(likes) {
  const patterns = {
    bingeLiking: false,
    consistentLiker: false,
    seasonalPatterns: false
  };
  
  if (likes.length < 10) return patterns;
  
  // Check for binge liking (many likes in short period)
  const likeDates = likes
    .filter(like => like.created_time)
    .map(like => new Date(like.created_time))
    .sort((a, b) => a - b);
  
  if (likeDates.length > 5) {
    const timeSpans = [];
    for (let i = 1; i < likeDates.length; i++) {
      timeSpans.push(likeDates[i] - likeDates[i - 1]);
    }
    
    const avgTimeSpan = timeSpans.reduce((a, b) => a + b, 0) / timeSpans.length;
    patterns.bingeLiking = avgTimeSpan < 24 * 60 * 60 * 1000; // Less than 1 day average
  }
  
  // Check for consistent liking (similar number per month)
  const monthlyCounts = {};
  likeDates.forEach(date => {
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    monthlyCounts[monthKey] = (monthlyCounts[monthKey] || 0) + 1;
  });
  
  const counts = Object.values(monthlyCounts);
  if (counts.length > 3) {
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((sum, count) => sum + Math.pow(count - avg, 2), 0) / counts.length;
    patterns.consistentLiker = variance < 5; // Low variance = consistent
  }
  
  return patterns;
}

/**
 * Count extracted text from OCR
 */
function countExtractedText(processedAlbums) {
  return processedAlbums.reduce((total, album) => {
    return total + (album.processedPhotos || 0);
  }, 0);
}

/**
 * Calculate average OCR confidence
 */
function calculateAverageOCRConfidence(processedAlbums) {
  if (!processedAlbums || processedAlbums.length === 0) return 0;
  
  const totalConfidence = processedAlbums.reduce((sum, album) => {
    return sum + (album.averageConfidence || 0);
  }, 0);
  
  return Math.round(totalConfidence / processedAlbums.length);
}

/**
 * Analyze posting rhythms
 */
function analyzePostingRhythms(feedData) {
  const rhythms = {
    peakHours: [],
    consistency: 0,
    frequency: 'low'
  };
  
  const postsWithTimes = feedData.filter(post => post.created_time);
  if (postsWithTimes.length < 5) return rhythms;
  
  // Group by hour
  const hourCounts = {};
  postsWithTimes.forEach(post => {
    const hour = new Date(post.created_time).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });
  
  // Find peak hours (top 3)
  rhythms.peakHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour]) => parseInt(hour));
  
  // Calculate consistency (inverse of variance)
  const counts = Object.values(hourCounts);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / counts.length;
  rhythms.consistency = Math.max(0, 100 - Math.round(variance * 10));
  
  // Determine frequency
  const totalDays = Math.max(1, 
    (new Date() - new Date(postsWithTimes[0].created_time)) / (1000 * 60 * 60 * 24)
  );
  const postsPerDay = postsWithTimes.length / totalDays;
  
  if (postsPerDay > 1) rhythms.frequency = 'high';
  else if (postsPerDay > 0.3) rhythms.frequency = 'medium';
  else rhythms.frequency = 'low';
  
  return rhythms;
}

/**
 * Calculate active hours
 */
function calculateActiveHours(feedData) {
  const activeHours = Array(24).fill(0);
  
  feedData.filter(post => post.created_time).forEach(post => {
    const hour = new Date(post.created_time).getHours();
    activeHours[hour]++;
  });
  
  return activeHours;
}

/**
 * Calculate interaction frequency
 */
function calculateInteractionFrequency(user) {
  const interactions = {
    postsPerWeek: 0,
    likesPerWeek: 0,
    engagementRate: 0
  };
  
  if (!user.createdAt) return interactions;
  
  const daysSinceJoin = Math.max(1, 
    (new Date() - new Date(user.createdAt)) / (1000 * 60 * 60 * 24)
  );
  const weeksSinceJoin = daysSinceJoin / 7;
  
  interactions.postsPerWeek = Math.round((user.feedData?.length || 0) / weeksSinceJoin);
  interactions.likesPerWeek = Math.round((user.likes?.length || 0) / weeksSinceJoin);
  
  // Engagement rate (posts + likes per week)
  interactions.engagementRate = interactions.postsPerWeek + interactions.likesPerWeek;
  
  return interactions;
}

/**
 * Analyze content type preferences
 */
function analyzeContentTypePreferences(user) {
  const preferences = {
    textPosts: 0,
    photoPosts: 0,
    linkShares: 0,
    videoPosts: 0
  };
  
  (user.feedData || []).forEach(post => {
    if (post.type === 'photo') preferences.photoPosts++;
    else if (post.type === 'video') preferences.videoPosts++;
    else if (post.link) preferences.linkShares++;
    else if (post.message || post.text) preferences.textPosts++;
  });
  
  const totalPosts = Object.values(preferences).reduce((a, b) => a + b, 0);
  if (totalPosts > 0) {
    Object.keys(preferences).forEach(key => {
      preferences[key] = Math.round((preferences[key] / totalPosts) * 100);
    });
  }
  
  return preferences;
}

/**
 * Calculate total data points
 */
function calculateTotalDataPoints(user) {
  const explicitProfileFields = Object.keys(user).filter(key => 
    user[key] && typeof user[key] !== 'object' && !Array.isArray(user[key])
  ).length;
  
  const dataPoints = {
    explicit: {
      profileFields: explicitProfileFields,
      posts: user.feedData?.length || 0,
      likes: user.likes?.length || 0,
      albums: user.albumsData?.length || 0,
      processedPhotos: countExtractedText(user.processedAlbums || [])
    },
    implicit: {
      behavioralPatterns: Object.keys(user.surveillance?.behavioralPatterns || {}).length,
      inferredTraits: Object.keys(user.surveillance?.inferredTraits || {}).length,
      lifestyleMarkers: Object.keys(user.surveillance?.lifestyleMarkers || {}).length,
      correlations: user.surveillance?.correlations?.length || 0
    },
    total: 0
  };
  
  // Calculate total
  dataPoints.total = 
    (dataPoints.explicit.profileFields || 0) +
    (dataPoints.explicit.posts || 0) +
    (dataPoints.explicit.likes || 0) +
    (dataPoints.explicit.albums || 0) +
    (dataPoints.explicit.processedPhotos || 0) +
    (dataPoints.implicit.behavioralPatterns || 0) +
    (dataPoints.implicit.inferredTraits || 0) +
    (dataPoints.implicit.lifestyleMarkers || 0) +
    (dataPoints.implicit.correlations || 0);
  
  return dataPoints;
}

/**
 * Calculate data freshness
 */
function calculateDataFreshness(user) {
  if (!user.lastUpdated) return 0;
  
  const daysSinceUpdate = Math.floor(
    (new Date() - new Date(user.lastUpdated)) / (1000 * 60 * 60 * 24)
  );
  
  if (daysSinceUpdate === 0) return 100;
  else if (daysSinceUpdate <= 7) return 80;
  else if (daysSinceUpdate <= 30) return 60;
  else if (daysSinceUpdate <= 90) return 40;
  else return 20;
}

/**
 * Calculate analysis confidence
 */
function calculateAnalysisConfidence(user) {
  let confidence = 0;
  
  // Base confidence on data availability
  if (user.feedData?.length > 50) confidence += 30;
  else if (user.feedData?.length > 20) confidence += 20;
  else if (user.feedData?.length > 5) confidence += 10;
  
  if (user.likes?.length > 100) confidence += 25;
  else if (user.likes?.length > 50) confidence += 15;
  else if (user.likes?.length > 10) confidence += 5;
  
  if (user.albumsData?.length > 5) confidence += 15;
  else if (user.albumsData?.length > 2) confidence += 10;
  else if (user.albumsData?.length > 0) confidence += 5;
  
  if (user.personalityScores && Object.keys(user.personalityScores).length > 0) confidence += 20;
  
  // Additional confidence from surveillance analysis
  if (user.surveillance?.behavioralPatterns) confidence += 10;
  
  return Math.min(100, confidence);
}

/**
 * Calculate profile completeness
 */
function calculateProfileCompleteness(user) {
  let completeness = 0;
  
  // Profile information
  if (user.name) completeness += 15;
  if (user.email) completeness += 15;
  if (user.gender) completeness += 10;
  if (user.birthday) completeness += 10;
  if (user.location) completeness += 10;
  if (user.hometown) completeness += 5;
  
  // Content
  if (user.feedData?.length > 0) completeness += 10;
  if (user.likes?.length > 0) completeness += 10;
  if (user.albumsData?.length > 0) completeness += 5;
  
  // Analysis
  if (user.personalityScores) completeness += 10;
  
  return Math.min(100, completeness);
}

/**
 * Calculate exploitation scenarios
 */
function calculateExploitationScenarios(profileData) {
  const scenarios = [];
  const vulnerability = profileData.surveillance?.vulnerabilityProfile || {};
  
  // 1. Behavioral Manipulation Scenario
  if (vulnerability.manipulationSusceptibility > 70 || 
      profileData.behavioral.engagementScore > 80) {
    scenarios.push({
      id: 'behavioral_manipulation',
      title: 'Behavioral Manipulation',
      risk: 'HIGH',
      score: vulnerability.manipulationSusceptibility || profileData.behavioral.engagementScore,
      description: 'Predictable behavior patterns make you susceptible to targeted manipulation',
      indicators: [
        `Active during ${profileData.behavioral.postingRhythms.peakHours.join(', ')}`,
        `${profileData.behavioral.postingRhythms.frequency} posting frequency`,
        `${profileData.psychological.personalityScores.conscientiousness || 50}% conscientiousness`
      ],
      exploitation: 'Advertisers can target you during peak activity hours with emotionally charged content',
      mitigation: 'Vary posting times, use ad blockers, be aware of emotional triggers'
    });
  }
  
  // 2. Identity Correlation Scenario
  const identityDataPoints = [
    profileData.identity.email,
    profileData.identity.birthday,
    profileData.identity.currentLocation?.name,
    profileData.identity.hometown?.name
  ].filter(Boolean).length;
  
  if (identityDataPoints >= 3) {
    scenarios.push({
      id: 'identity_correlation',
      title: 'Identity Correlation',
      risk: 'CRITICAL',
      score: Math.min(100, identityDataPoints * 25),
      description: 'Multiple identity markers enable cross-platform tracking and re-identification',
      indicators: [
        `${identityDataPoints} unique identity markers`,
        profileData.identity.email ? 'Email address available' : '',
        profileData.identity.birthday ? 'Birthday visible' : '',
        profileData.identity.currentLocation?.name ? `Location: ${profileData.identity.currentLocation.name}` : ''
      ],
      exploitation: 'Data brokers can link your Facebook identity to other online profiles',
      mitigation: 'Remove unnecessary personal information, use pseudonyms, limit location sharing'
    });
  }
  
  // 3. Content Analysis Exploitation
  if (profileData.content.posts.count > 50) {
    scenarios.push({
      id: 'content_exploitation',
      title: 'Content Analysis Exploitation',
      risk: 'HIGH',
      score: Math.min(100, profileData.content.posts.count),
      description: 'Extensive content history enables detailed psychological profiling',
      indicators: [
        `${profileData.content.posts.count} posts analyzed`,
        `${profileData.content.likes.count} likes categorized`,
        `${profileData.psychological.vocabulary.uniqueWords} unique words used`
      ],
      exploitation: 'AI can infer personality traits, political views, and psychological vulnerabilities',
      mitigation: 'Review and delete old posts, limit data collection permissions'
    });
  }
  
  // 4. Visual Data Exposure
  if (profileData.content.images.processedPhotos > 10) {
    scenarios.push({
      id: 'visual_exposure',
      title: 'Visual Data Exposure',
      risk: 'MEDIUM',
      score: Math.min(100, profileData.content.images.processedPhotos * 3),
      description: 'Photos reveal locations, social circles, and lifestyle patterns',
      indicators: [
        `${profileData.content.images.processedPhotos} photos with extracted text`,
        `${profileData.content.images.albumCount} photo albums`,
        `OCR confidence: ${profileData.content.images.ocrConfidence}%`
      ],
      exploitation: 'Photos can be analyzed for location data, brand preferences, and social connections',
      mitigation: 'Review photo privacy settings, remove location metadata, limit album visibility'
    });
  }
  
  return scenarios;
}

/**
 * Calculate privacy risk assessment
 */
function calculatePrivacyRiskAssessment(profileData) {
  const risk = {
    overall: 0,
    categories: {},
    recommendations: []
  };
  
  // Calculate category risks
  risk.categories.identity = calculateIdentityRisk(profileData.identity);
  risk.categories.content = calculateContentRisk(profileData.content);
  risk.categories.behavioral = calculateBehavioralRisk(profileData.behavioral);
  
  // Overall risk (weighted average)
  risk.overall = Math.round(
    (risk.categories.identity * 0.4) +
    (risk.categories.content * 0.3) +
    (risk.categories.behavioral * 0.3)
  );
  
  // Generate recommendations
  if (risk.categories.identity > 70) {
    risk.recommendations.push({
      priority: 'HIGH',
      action: 'Remove personal identifiers',
      details: 'Consider removing birthday, specific location, and other unique identifiers'
    });
  }
  
  if (risk.categories.content > 70) {
    risk.recommendations.push({
      priority: 'HIGH',
      action: 'Review and clean old content',
      details: 'Delete old posts and limit future sharing to close friends'
    });
  }
  
  if (risk.categories.behavioral > 70) {
    risk.recommendations.push({
      priority: 'MEDIUM',
      action: 'Vary your activity patterns',
      details: 'Post at different times to avoid predictable patterns'
    });
  }
  
  return risk;
}

/**
 * Calculate identity risk
 */
function calculateIdentityRisk(identity) {
  let risk = 0;
  
  if (identity.email) risk += 30;
  if (identity.birthday) risk += 25;
  if (identity.currentLocation?.name) risk += 20;
  if (identity.hometown?.name) risk += 15;
  if (identity.languages?.length > 0) risk += 10;
  
  return Math.min(100, risk);
}

/**
 * Calculate content risk
 */
function calculateContentRisk(content) {
  let risk = 0;
  
  if (content.posts.count > 100) risk += 30;
  else if (content.posts.count > 50) risk += 20;
  else if (content.posts.count > 20) risk += 10;
  
  if (content.likes.count > 200) risk += 25;
  else if (content.likes.count > 100) risk += 15;
  else if (content.likes.count > 50) risk += 10;
  
  if (content.images.processedPhotos > 50) risk += 25;
  else if (content.images.processedPhotos > 20) risk += 15;
  else if (content.images.processedPhotos > 10) risk += 10;
  
  return Math.min(100, risk);
}

/**
 * Calculate behavioral risk
 */
function calculateBehavioralRisk(behavioral) {
  let risk = 0;
  
  if (behavioral.postingRhythms.consistency > 80) risk += 30;
  else if (behavioral.postingRhythms.consistency > 60) risk += 20;
  
  if (behavioral.engagementRate > 20) risk += 25;
  else if (behavioral.engagementRate > 10) risk += 15;
  
  if (behavioral.postingRhythms.frequency === 'high') risk += 25;
  else if (behavioral.postingRhythms.frequency === 'medium') risk += 15;
  
  return Math.min(100, risk);
}

/**
 * Calculate entity views
 */
function calculateEntityViews(profileData) {
  return {
    facebook: {
      name: 'Facebook Platform View',
      description: 'What Facebook sees: Complete access to all explicit and inferred data',
      dataAccess: [
        {
          category: 'Profile Data',
          items: [
            `Name: ${profileData.identity.name}`,
            `Email: ${profileData.identity.email || 'Not provided'}`,
            `Birthday: ${profileData.identity.birthday || 'Not provided'}`,
            `Location: ${profileData.identity.currentLocation?.name || 'Not provided'}`,
            `Languages: ${profileData.identity.languages?.map(l => l.name).join(', ') || 'Not specified'}`
          ]
        },
        {
          category: 'Activity Data',
          items: [
            `${profileData.content.posts.count} posts with full text analysis`,
            `${profileData.content.likes.count} likes across ${profileData.content.likes.categories.length} categories`,
            `${profileData.content.images.albumCount} albums with ${profileData.content.images.processedPhotos} processed photos`,
            `Active ${profileData.behavioral.postingRhythms.frequency} with ${profileData.behavioral.engagementRate} engagements per week`
          ]
        },
        {
          category: 'Inferred Data',
          items: [
            `Personality: ${JSON.stringify(profileData.psychological.personalityScores)}`,
            `Primary Interest: ${profileData.psychological.areaOfInterest}`,
            `Behavioral Patterns: ${JSON.stringify(profileData.behavioral.postingRhythms)}`,
            `Psychological Traits: ${JSON.stringify(profileData.surveillance.inferredTraits || {})}`
          ]
        }
      ]
    },
    advertiser: {
      name: 'Advertiser View',
      description: 'What advertisers can target: Demographic and interest-based segments',
      dataAccess: [
        {
          category: 'Targeting Attributes',
          items: [
            `Age: ${profileData.identity.age_range || 'Unknown'}`,
            `Gender: ${profileData.identity.gender || 'Unknown'}`,
            `Location: ${profileData.identity.currentLocation?.name || 'Unknown'}`,
            `Languages: ${profileData.identity.languages?.slice(0, 2).map(l => l.name).join(', ') || 'Unknown'}`
          ]
        },
        {
          category: 'Interest Categories',
          items: [
            `Primary Interest: ${profileData.psychological.areaOfInterest}`,
            `Like Categories: ${profileData.content.likes.categories.slice(0, 3).map(c => c.category).join(', ')}`,
            `Post Topics: ${profileData.content.posts.mostCommonTopics.slice(0, 3).map(t => t.topic).join(', ')}`
          ]
        },
        {
          category: 'Behavioral Attributes',
          items: [
            `Engagement Level: ${profileData.behavioral.engagementScore}/100`,
            `Activity Pattern: ${profileData.behavioral.postingRhythms.frequency}`,
            `Peak Activity: ${profileData.behavioral.postingRhythms.peakHours.map(h => `${h}:00`).join(', ')}`
          ]
        }
      ]
    },
    dataBroker: {
      name: 'Data Broker View',
      description: 'What data brokers aggregate: Comprehensive profiles for resale',
      dataAccess: [
        {
          category: 'Identity Resolution',
          items: [
            'Full name + email for cross-platform matching',
            'Location history and hometown',
            'Demographic profile (age, gender, languages)',
            'Social connections and network size'
          ]
        },
        {
          category: 'Behavioral Profiling',
          items: [
            'Complete posting history and patterns',
            'Like preferences and category affinities',
            'Photo metadata and extracted text',
            'Temporal behavior patterns'
          ]
        },
        {
          category: 'Predictive Analytics',
          items: [
            'Personality trait predictions',
            'Interest evolution over time',
            'Purchase intent signals',
            'Life event predictions'
          ]
        }
      ]
    }
  };
}

/**
 * Analyze temporal patterns
 */
function analyzeTemporalPatterns(user) {
  const patterns = {
    growth: {},
    seasonality: {},
    trends: {}
  };
  
  if (!user.createdAt) return patterns;
  
  const joinDate = new Date(user.createdAt);
  const now = new Date();
  const monthsSinceJoin = Math.max(1, 
    (now.getFullYear() - joinDate.getFullYear()) * 12 + 
    (now.getMonth() - joinDate.getMonth())
  );
  
  // Growth patterns
  patterns.growth = {
    accountAge: monthsSinceJoin,
    contentGrowth: user.feedData?.length / monthsSinceJoin || 0,
    engagementGrowth: user.engagementScore || 0
  };
  
  // Seasonality (placeholder - would need time-series data)
  patterns.seasonality = {
    hasPatterns: false,
    notes: 'Seasonal analysis requires longer time-series data'
  };
  
  // Trend analysis
  patterns.trends = {
    recentActivity: user.lastUpdated ? 
      Math.floor((now - new Date(user.lastUpdated)) / (1000 * 60 * 60 * 24)) : 
      'Unknown days ago',
    activityTrend: 'stable' // placeholder
  };
  
  return patterns;
}

/**
 * Assess cross-platform correlation potential
 */
function assessCrossPlatformCorrelation(user) {
  const correlation = {
    potential: 'medium',
    indicators: [],
    confidence: 50
  };
  
  // Check for unique identifiers
  if (user.email) {
    correlation.indicators.push('Email address for matching');
    correlation.confidence += 20;
  }
  
  if (user.birthday && user.location?.name) {
    correlation.indicators.push('Birthday + location combination');
    correlation.confidence += 15;
  }
  
  if (user.name && user.hometown?.name) {
    correlation.indicators.push('Name + hometown combination');
    correlation.confidence += 10;
  }
  
  if (user.languages?.length > 0) {
    correlation.indicators.push('Language preferences');
    correlation.confidence += 5;
  }
  
  correlation.confidence = Math.min(100, correlation.confidence);
  
  if (correlation.confidence > 70) correlation.potential = 'high';
  else if (correlation.confidence > 40) correlation.potential = 'medium';
  else correlation.potential = 'low';
  
  return correlation;
}

// ==================== ENHANCED DASHBOARD ROUTE ====================

router.get('/dashboard', authenticateToken, wrapAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user from database
    const user = await User.findOne({ id: userId });
    if (!user) return res.redirect('/');
    
    // Ensure surveillance object exists
    if (!user.surveillance) {
      user.surveillance = {
        vulnerabilityProfile: {},
        surveillanceMetadata: {},
        threatHistory: [],
        trackerDatabase: []
      };
      await user.save();
    }
    
    // Get comprehensive Facebook data analysis
    const facebookAnalysis = await analyzeFacebookDataComprehensive(userId);
    
    if (!facebookAnalysis) {
      logger.error(`Failed to analyze Facebook data for user ${userId}`);
      return res.status(500).render('error', {
        err: { status: 500, message: 'Failed to analyze Facebook data' },
        title: 'Analysis Error',
        nonce: res.locals.nonce
      });
    }
    
    // Get real-time user data (if exists)
    const rtData = realTimeUserData.get(userId) || {
      activities: [],
      riskScore: 0,
      threatLevel: 'LOW'
    };
    
    // Calculate additional metrics with template-compatible structure
    const metrics = {
      surveillance: {
        totalDataPoints: facebookAnalysis.metrics.dataPoints.total || 0,
        analysisConfidence: facebookAnalysis.metrics.analysisConfidence || 0,
        profileCompleteness: facebookAnalysis.metrics.profileCompleteness || 0,
        dataFreshness: facebookAnalysis.metrics.dataFreshness || 0
      },
      privacy: {
        overallRisk: facebookAnalysis.privacyRisk?.overall || 0,
        identityRisk: facebookAnalysis.privacyRisk?.categories?.identity || 0,
        contentRisk: facebookAnalysis.privacyRisk?.categories?.content || 0,
        behavioralRisk: facebookAnalysis.privacyRisk?.categories?.behavioral || 0
      },
      // Add template-compatible dataPoints structure
      dataPoints: {
        detailed: {
          profileInfo: facebookAnalysis.metrics.dataPoints?.explicit?.profileFields || 0
        }
      }
    };
    
    // Prepare dashboard data with template-compatible structure
    const dashboardData = {
      // User Information
      user: {
        id: user.id,
        username: user.username || user.name,
        email: user.email,
        lastLogin: user.lastLogin,
        accountAge: user.createdAt ? 
          Math.floor((new Date() - new Date(user.createdAt)) / (1000 * 60 * 60 * 24)) : 0
      },
      
      // Comprehensive Facebook Analysis
      facebook: {
        ...facebookAnalysis,
        // Ensure all required properties exist for template
        metrics: {
          ...facebookAnalysis.metrics,
          dataPoints: {
            ...facebookAnalysis.metrics.dataPoints,
            detailed: {
              profileInfo: facebookAnalysis.metrics.dataPoints?.explicit?.profileFields || 0
            }
          }
        },
        // Add activity data if not present
        activity: {
          posts: { count: facebookAnalysis.content?.posts?.count || 0 },
          likes: { count: facebookAnalysis.content?.likes?.count || 0 },
          albums: { count: facebookAnalysis.content?.images?.albumCount || 0 }
        }
      },
      
      // Real-time Metrics
      realTime: {
        riskScore: rtData.riskScore,
        threatLevel: rtData.threatLevel,
        analysisTimestamp: facebookAnalysis.analysisTimestamp,
        lastDataRefresh: user.lastUpdated
      },
      
      // Metrics & Statistics
      metrics: metrics,
      
      // Summary Statistics
      summary: {
        totalPosts: facebookAnalysis.content?.posts?.count || 0,
        totalLikes: facebookAnalysis.content?.likes?.count || 0,
        totalAlbums: facebookAnalysis.content?.images?.albumCount || 0,
        totalPhotos: facebookAnalysis.content?.images?.processedPhotos || 0,
        engagementScore: facebookAnalysis.behavioral?.engagementScore || 0,
        personalityScore: facebookAnalysis.psychological?.personalityScores?.openness || 50,
        dataCollectedSince: user.createdAt || new Date()
      },
      
      // Surveillance Status
      surveillance: {
        hasAnalysis: !!facebookAnalysis.surveillance?.behavioralPatterns,
        vulnerabilityScore: facebookAnalysis.surveillance?.vulnerabilityProfile?.manipulationSusceptibility || 50,
        exploitationScenarios: facebookAnalysis.exploitationScenarios?.length || 0,
        privacyRecommendations: facebookAnalysis.privacyRisk?.recommendations?.length || 0
      }
    };
    
    // Build the `surveillance` object in the exact shape the template expects.
    // (The template referenced a top-level `surveillance` var the route never
    // passed, causing a 500: "surveillance is not defined".)
    const _sv = user.surveillance || {};
    const _beh = _sv.behavioralPatterns || {};
    const _traits = _sv.inferredTraits || {};
    const _graph = _sv.socialGraph || {};
    const _vuln = _sv.vulnerabilityProfile || {};
    const _meta = _sv.surveillanceMetadata || {};
    const _num = (v) => (typeof v === 'number' && !isNaN(v)) ? Math.round(v) : 0;
    const surveillanceView = {
      metadata: {
        lastFullAnalysis: _meta.lastFullAnalysis || user.lastAnalyzed || null
      },
      behavioral: {
        peakActivity: Array.isArray(_beh.activeHours) ? _beh.activeHours : [],
        postingCycle: { regularity: _num(_beh.habitStrength) },
        responseTime: { avgMinutes: _num(_sv.interactions && _sv.interactions.responseLatency) }
      },
      psychographic: {
        primaryTraits: Object.keys(_traits),
        motivations: Array.isArray(_sv.lifestyleMarkers && _sv.lifestyleMarkers.diningPreferences) ? _sv.lifestyleMarkers.diningPreferences : [],
        values: Array.isArray(_graph.communities) ? _graph.communities : []
      },
      social: {
        clusters: Array.isArray(_graph.communities) ? _graph.communities : [],
        connections: { total: _num((user.likes || []).length) },
        influenceScore: _num(_graph.influenceScore)
      },
      vulnerability: {
        dataExposureLevel: _num(_vuln.dataExposureLevel),
        dataRichness: _num(_vuln.profilingDepth),
        manipulationSusceptibility: _num(_vuln.manipulationSusceptibility),
        patternRisk: _num(_beh.habitStrength),
        predictabilityScore: _num(_vuln.optOutDifficulty),
        reidentificationRisk: _num(_vuln.reidentificationRisk)
      }
    };

    res.render('surveillance/dashboard', {
      title: 'VisiSocial - Facebook Surveillance Dashboard',
      user,
      dashboard: dashboardData,
      surveillance: surveillanceView,
      moment: moment,
      lastUpdated: new Date(),
      nonce: res.locals.nonce,
      isAuthenticated: true,
      monitoringActive: true,
      hasFacebookData: true,
      facebookAnalysisComplete: user.analysisComplete
    });
    
  } catch (error) {
    logger.error(`Surveillance dashboard error: ${error.message}`);
    res.status(500).render('error', {
      err: { status: 500, message: 'Error loading surveillance dashboard' },
      title: 'Dashboard Error',
      nonce: res.locals.nonce
    });
  }
}));

// ==================== SURVEILLANCE DETAIL PAGES ====================

const _svNum = (v) => (typeof v === 'number' && !isNaN(v)) ? Math.round(v) : 0;

router.get('/profile-depth', authenticateToken, wrapAsync(async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.redirect('/');
    const sv = user.surveillance || {};
    const traits = sv.inferredTraits || {};
    const life = sv.lifestyleMarkers || {};
    const beh = sv.behavioralPatterns || {};
    const p = user.personalityScores || {};
    const peak = beh.peakActivityTime || 'evening';

    const profile = {
      explicit: {
        name: user.name || 'Unknown',
        email: user.email || 'Not shared',
        gender: user.gender || 'Unknown',
        location: (user.location && user.location.name) || (user.hometown && user.hometown.name) || 'Unknown',
        birthday: user.birthday || 'Unknown'
      },
      derived: {
        'Primary interest': user.areaOfInterest || 'General',
        'Openness': `${p.openness != null ? p.openness : 50}%`,
        'Conscientiousness': `${p.conscientiousness != null ? p.conscientiousness : 50}%`,
        'Risk tolerance': `${_svNum(traits.riskTolerance)}%`,
        'Socioeconomic status': life.socioeconomicStatus || 'Unknown',
        'Education level': life.educationLevel || 'Unknown',
        'Career stage': life.careerStage || 'Unknown'
      }
    };

    const transformations = [
      { input: `${(user.likes || []).length} page likes`, process: 'Interest clustering & categorization', output: `Primary interest: ${user.areaOfInterest || 'General'}`, sensitivity: 'Medium' },
      { input: `${(user.feedData || []).length} posts analyzed`, process: 'Big Five personality inference', output: `Openness ${p.openness != null ? p.openness : 50}%, Conscientiousness ${p.conscientiousness != null ? p.conscientiousness : 50}%`, sensitivity: 'High' },
      { input: 'Post timestamps', process: 'Circadian rhythm analysis', output: `Peak activity: ${peak}`, sensitivity: 'High' },
      { input: 'Language patterns', process: 'Psychographic inference', output: `Risk tolerance ${_svNum(traits.riskTolerance)}%, Impulsivity ${_svNum(traits.impulsivity)}%`, sensitivity: 'Critical' }
    ];

    const dataPoints = (user.feedData?.length || 0) * 50 + (user.likes?.length || 0) * 10;

    res.render('surveillance/profile-depth', {
      title: 'VisiSocial - Profile Depth Analysis',
      user, profile, transformations, dataPoints,
      nonce: res.locals.nonce
    });
  } catch (error) {
    logger.error(`Profile-depth error: ${error.message}`);
    res.status(500).render('error', { err: { status: 500, message: 'Error loading profile depth' }, title: 'Error', nonce: res.locals.nonce });
  }
}));

router.get('/exploitation-risk', authenticateToken, wrapAsync(async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.redirect('/');
    const sv = user.surveillance || {};
    const vp = sv.vulnerabilityProfile || {};
    const beh = sv.behavioralPatterns || {};

    const vulnerability = {
      dataExposureLevel: _svNum(vp.dataExposureLevel),
      manipulationSusceptibility: _svNum(vp.manipulationSusceptibility),
      predictabilityScore: _svNum(vp.optOutDifficulty),
      reidentificationRisk: _svNum(vp.reidentificationRisk)
    };
    const overallRisk = Math.round(Object.values(vulnerability).reduce((a, b) => a + b, 0) / 4);

    const scenarios = [
      { type: 'Behavioral Prediction', risk: vulnerability.predictabilityScore > 60 ? 'HIGH' : 'MEDIUM', vector: `Predictable routines (${_svNum(beh.habitStrength)}% habit strength) allow timing of targeted messaging.`, mitigation: 'Vary your activity patterns and limit location/timestamp sharing.' },
      { type: 'Emotional Manipulation', risk: vulnerability.manipulationSusceptibility > 60 ? 'CRITICAL' : vulnerability.manipulationSusceptibility > 40 ? 'HIGH' : 'MEDIUM', vector: `Inferred susceptibility (${vulnerability.manipulationSusceptibility}%) enables emotionally-targeted persuasion.`, mitigation: 'Be cautious of urgency/scarcity tactics and review your ad preferences.' },
      { type: 'Re-identification', risk: vulnerability.reidentificationRisk > 60 ? 'HIGH' : 'MEDIUM', vector: `Combined public attributes give a ${vulnerability.reidentificationRisk}% re-identification risk.`, mitigation: 'Reduce public profile fields and tighten privacy settings.' },
      { type: 'Data Aggregation', risk: vulnerability.dataExposureLevel > 60 ? 'HIGH' : 'MODERATE', vector: `${vulnerability.dataExposureLevel}% data exposure across collected signals enables broker profiling.`, mitigation: 'Request data deletion and minimize third-party app permissions.' }
    ];

    res.render('surveillance/exploitation-risk', {
      title: 'VisiSocial - Exploitation Risk',
      user, vulnerability, scenarios, overallRisk,
      nonce: res.locals.nonce
    });
  } catch (error) {
    logger.error(`Exploitation-risk error: ${error.message}`);
    res.status(500).render('error', { err: { status: 500, message: 'Error loading exploitation risk' }, title: 'Error', nonce: res.locals.nonce });
  }
}));

router.get('/cross-modal', authenticateToken, wrapAsync(async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.redirect('/');
    const sv = user.surveillance || {};
    const corr = Array.isArray(sv.correlations) ? sv.correlations : [];

    const correlations = corr.map(c => ({
      type: (c.pattern || 'pattern').replace(/_/g, ' '),
      confidence: typeof c.confidence === 'number' ? Math.round(c.confidence * 100) : 0,
      description: c.sensitivity ? `${c.sensitivity} sensitivity` : 'Cross-source correlation',
      insight: c.insight || '',
      sources: Array.isArray(c.sources) ? c.sources : []
    }));

    res.render('surveillance/cross-modal', {
      title: 'VisiSocial - Cross-Modal Intelligence',
      user, correlations, totalCorrelations: correlations.length,
      nonce: res.locals.nonce
    });
  } catch (error) {
    logger.error(`Cross-modal error: ${error.message}`);
    res.status(500).render('error', { err: { status: 500, message: 'Error loading cross-modal analysis' }, title: 'Error', nonce: res.locals.nonce });
  }
}));

router.get('/compare-models', authenticateToken, wrapAsync(async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.redirect('/');
    const sv = user.surveillance || {};
    const traits = sv.inferredTraits || {};
    const beh = sv.behavioralPatterns || {};
    const p = user.personalityScores || {};
    const peak = beh.peakActivityTime || 'evening';
    const interests = (user.likes || []).map(l => (l && l.name) ? l.name : '').filter(Boolean);

    const views = {
      platform: { data: {
        explicit: {
          Name: user.name || 'Unknown',
          Email: user.email || 'Connected',
          Gender: user.gender || 'Unknown',
          Location: (user.location && user.location.name) || 'Tracked'
        },
        inferred: {
          'Primary interest': user.areaOfInterest || 'General',
          Openness: `${p.openness != null ? p.openness : 50}%`,
          'Risk tolerance': `${_svNum(traits.riskTolerance)}%`
        },
        behavioral: {
          'Peak activity': peak,
          Posts: String((user.feedData || []).length),
          Likes: String((user.likes || []).length)
        }
      }},
      advertiser: { data: {
        demographics: {
          'Age range': (user.age_range && user.age_range.min) ? `${user.age_range.min}+` : 'Inferred',
          Gender: user.gender || 'Unknown',
          Location: (user.location && user.location.name) || 'Tracked'
        },
        interests,
        targeting: {
          'Purchase intent': `${_svNum(traits.materialistic)}%`,
          'Ad susceptibility': `${_svNum((sv.vulnerabilityProfile || {}).manipulationSusceptibility)}%`
        }
      }},
      broker: { data: {
        crossPlatformId: 'Linked across platforms (inferred)',
        offlineData: 'Purchase history, Property records, Credit estimate',
        predictive: 'Life events predicted 6-12 months ahead'
      }}
    };

    res.render('surveillance/compare-models', {
      title: 'VisiSocial - Model Comparison',
      user, views,
      nonce: res.locals.nonce
    });
  } catch (error) {
    logger.error(`Compare-models error: ${error.message}`);
    res.status(500).render('error', { err: { status: 500, message: 'Error loading model comparison' }, title: 'Error', nonce: res.locals.nonce });
  }
}));

// ==================== REAL-TIME DATA ENDPOINTS ====================

router.get('/dashboard-data', authenticateToken, wrapAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get fresh analysis
    const facebookAnalysis = await analyzeFacebookDataComprehensive(userId);
    
    if (!facebookAnalysis) {
      return res.json({ error: 'No data available' });
    }
    
    // Prepare real-time update data
    const updateData = {
      timestamp: new Date(),
      metrics: {
        riskScore: facebookAnalysis.privacyRisk?.overall || 0,
        exploitationScenarios: facebookAnalysis.exploitationScenarios?.length || 0,
        dataFreshness: facebookAnalysis.metrics?.dataFreshness || 0,
        analysisConfidence: facebookAnalysis.metrics?.analysisConfidence || 0
      },
      recentActivity: {
        lastPost: facebookAnalysis.content?.posts?.recent?.[0] || null,
        lastLike: facebookAnalysis.content?.likes?.categories?.[0] || null,
        recentTopics: (facebookAnalysis.content?.posts?.mostCommonTopics || []).slice(0, 3)
      },
      behavioral: {
        currentActivity: facebookAnalysis.behavioral?.postingRhythms?.frequency || 'low',
        peakHours: facebookAnalysis.behavioral?.postingRhythms?.peakHours || [],
        consistency: facebookAnalysis.behavioral?.postingRhythms?.consistency || 0
      }
    };
    
    res.json(updateData);
  } catch (error) {
    logger.error(`Dashboard data error: ${error.message}`);
    res.json({ error: 'Failed to load data' });
  }
}));

// ==================== REFRESH FACEBOOK DATA ====================

router.post('/refresh-facebook-data', authenticateToken, wrapAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if taskStatus exists
    let taskStatus;
    try {
      taskStatus = require('../utils/taskStatus');
    } catch (error) {
      taskStatus = {
        getUserTasks: () => [],
        create: () => ({ id: Date.now().toString() }),
        start: () => {},
        fail: () => {},
        complete: () => {}
      };
    }
    
    // Trigger Facebook data refresh
    const userTasks = taskStatus.getUserTasks ? taskStatus.getUserTasks(userId) : [];
    let task = userTasks.find(t => t.state === 'running' || t.state === 'pending');
    
    if (!task && taskStatus.create) {
      task = taskStatus.create(userId, 'facebook_refresh', {
        source: 'surveillance_dashboard',
        type: 'facebook_refresh'
      });
      if (taskStatus.start) taskStatus.start(task.id, 9, 'Refreshing Facebook data...');
    }
    
    // Start background processing
    setImmediate(async () => {
      try {
        const user = await User.findOne({ id: userId });
        if (!user) {
          if (task && taskStatus.fail) taskStatus.fail(task.id, new Error('User not found'), 'User not found');
          return;
        }
        
        // Reset user status to trigger re-analysis
        user.status = 'processing';
        user.lastUpdated = new Date();
        await user.save();
        
        // Import the processUserDataInBackground function
        const { processUserDataInBackground } = require('./homeRoute');
        
        // Re-run analysis
        await processUserDataInBackground(userId, req.user.accessToken);
        
        if (task && taskStatus.complete) taskStatus.complete(task.id, { userId }, 'Facebook data refreshed!');
        
      } catch (error) {
        console.error('Facebook refresh error:', error);
        if (task && taskStatus.fail) taskStatus.fail(task.id, error, 'Facebook refresh failed');
      }
    });
    
    res.json({ 
      success: true, 
      message: 'Facebook data refresh started',
      redirect: '/surveillance/dashboard'
    });
    
  } catch (error) {
    logger.error(`Facebook refresh error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Error refreshing Facebook data' 
    });
  }
}));

// ==================== EXPORT ENHANCED DATA ====================

router.get('/export-comprehensive-data', authenticateToken, wrapAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get comprehensive analysis
    const facebookAnalysis = await analyzeFacebookDataComprehensive(userId);
    
    if (!facebookAnalysis) {
      return res.status(404).json({ error: 'No surveillance data available' });
    }
    
    const exportData = {
      metadata: {
        userId,
        exportedAt: new Date().toISOString(),
        exportVersion: '2.0',
        analysisType: 'facebook_surveillance'
      },
      summary: {
        profileInfo: {
          name: facebookAnalysis.identity.name,
          dataPoints: facebookAnalysis.metrics.dataPoints.total || 0,
          completeness: facebookAnalysis.metrics.profileCompleteness || 0
        },
        contentAnalysis: {
          posts: facebookAnalysis.content?.posts?.count || 0,
          likes: facebookAnalysis.content?.likes?.count || 0,
          photos: facebookAnalysis.content?.images?.processedPhotos || 0
        },
        privacyRisk: facebookAnalysis.privacyRisk?.overall || 0,
        exploitationScenarios: facebookAnalysis.exploitationScenarios?.length || 0
      },
      detailedAnalysis: facebookAnalysis,
      recommendations: facebookAnalysis.privacyRisk?.recommendations || [],
      entityViews: facebookAnalysis.entityViews || {},
      exportMetadata: {
        generatedBy: 'VisiSocial Surveillance System',
        purpose: 'User data transparency report',
        confidentiality: 'CONFIDENTIAL - User Data'
      }
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 
      `attachment; filename=facebook-surveillance-${userId}-${Date.now()}.json`
    );
    res.json(exportData);
  } catch (error) {
    logger.error(`Export error: ${error.message}`);
    res.status(500).json({ error: 'Failed to export data' });
  }
}));

// ==================== CLEAR DATA WITH BACKUP ====================

router.post('/clear-data', authenticateToken, wrapAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Create backup before clearing
    const backup = {
      timestamp: new Date(),
      userId,
      activitiesCleared: realTimeUserData.get(userId)?.activities?.length || 0
    };
    
    // Clear real-time data only (not Facebook data)
    realTimeUserData.delete(userId);
    
    logger.info(`Cleared surveillance data for user ${userId}`, { backup });
    
    res.json({ 
      success: true, 
      message: 'Surveillance monitoring data cleared successfully',
      backup,
      note: 'Facebook profile data remains intact'
    });
  } catch (error) {
    logger.error(`Clear data error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Error clearing data' 
    });
  }
}));

// ==================== GET SPECIFIC ANALYSIS ====================

router.get('/analysis/:type', authenticateToken, wrapAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const analysisType = req.params.type;
    
    const facebookAnalysis = await analyzeFacebookDataComprehensive(userId);
    
    if (!facebookAnalysis) {
      return res.status(404).json({ error: 'No analysis available' });
    }
    
    let analysisData;
    
    switch(analysisType) {
      case 'behavioral':
        analysisData = {
          type: 'behavioral',
          data: facebookAnalysis.behavioral || {},
          risk: facebookAnalysis.privacyRisk?.categories?.behavioral || 0,
          scenarios: (facebookAnalysis.exploitationScenarios || []).filter(s => 
            s.id.includes('behavioral')
          )
        };
        break;
        
      case 'content':
        analysisData = {
          type: 'content',
          data: facebookAnalysis.content || {},
          risk: facebookAnalysis.privacyRisk?.categories?.content || 0,
          scenarios: (facebookAnalysis.exploitationScenarios || []).filter(s => 
            s.id.includes('content')
          )
        };
        break;
        
      case 'privacy':
        analysisData = {
          type: 'privacy',
          data: facebookAnalysis.privacyRisk || {},
          entityViews: facebookAnalysis.entityViews || {},
          recommendations: facebookAnalysis.privacyRisk?.recommendations || []
        };
        break;
        
      case 'psychological':
        analysisData = {
          type: 'psychological',
          data: facebookAnalysis.psychological || {},
          personalityDescription: facebookAnalysis.psychological?.personalityDescription || '',
          areaOfInterest: facebookAnalysis.psychological?.areaOfInterest || 'General'
        };
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid analysis type' });
    }
    
    res.json({
      success: true,
      analysis: analysisData,
      timestamp: new Date()
    });
    
  } catch (error) {
    logger.error(`Analysis error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get analysis' 
    });
  }
}));

module.exports = router;