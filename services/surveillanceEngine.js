const User = require('../models/User');
const logger = require('../utils/logger');
const natural = require('natural');

class SurveillanceEngine {
  
  /**
   * BEHAVIORAL RHYTHM ANALYSIS
   * Detect posting patterns that reveal daily routines
   */
  static async analyzeBehavioralRhythms(userId, feedData) {
    const postTimes = feedData
      .filter(post => post.created_time)
      .map(post => new Date(post.created_time));
    
    if (postTimes.length < 10) return null;
    
    // Build posting cycle heatmap
    const cycleMap = {};
    postTimes.forEach(time => {
      const day = time.getDay();
      const hour = time.getHours();
      const key = `${day}-${hour}`;
      cycleMap[key] = (cycleMap[key] || 0) + 1;
    });
    
    // Convert to structured format
    const postingCycle = Object.entries(cycleMap).map(([key, freq]) => {
      const [day, hour] = key.split('-').map(Number);
      return { dayOfWeek: day, hourOfDay: hour, frequency: freq };
    });
    
    // Calculate consistency (how predictable are posting times?)
    const variance = this._calculateTimeVariance(postTimes);
    const consistency = Math.max(0, 100 - variance);
    
    // Circadian alignment (do they post during "normal" waking hours?)
    const daytimePosts = postTimes.filter(t => {
      const h = t.getHours();
      return h >= 7 && h <= 23;
    }).length;
    const circadianAlignment = Math.round((daytimePosts / postTimes.length) * 100);
    
    // Habit strength (entropy of posting distribution)
    const entropy = this._calculateEntropy(Object.values(cycleMap));
    const habitStrength = Math.round((1 - entropy / Math.log(168)) * 100); // 168 = 7*24
    
    // Active hours
    const hourCounts = {};
    postTimes.forEach(t => {
      hourCounts[t.getHours()] = (hourCounts[t.getHours()] || 0) + 1;
    });
    const activeHours = Object.entries(hourCounts)
      .filter(([_, count]) => count >= postTimes.length * 0.05)
      .map(([hour]) => parseInt(hour))
      .sort((a, b) => a - b);
    
    // Peak activity time
    const peakHour = Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])[0][0];
    const peakActivityTime = this._formatTimeRange(parseInt(peakHour));
    
    return {
      postingCycle,
      circadianAlignment,
      habitStrength,
      activeHours,
      peakActivityTime,
      consistency
    };
  }
  
  /**
   * PSYCHOGRAPHIC INFERENCE
   * Infer psychological traits from language and behavior
   */
  static async inferPsychographics(userId, textData, imageData, likesData) {
    const traits = {};
    
    // Risk Tolerance (from language: "gamble", "risky", "adventure" vs "safe", "secure")
    const riskWords = ['risk', 'gamble', 'adventure', 'dare', 'extreme', 'wild'];
    const safeWords = ['safe', 'secure', 'careful', 'cautious', 'stable', 'reliable'];
    const riskScore = this._wordFrequencyScore(textData, riskWords, safeWords);
    traits.riskTolerance = riskScore;
    
    // Impulsivity (from posting frequency variance and language)
    const impulsiveWords = ['now', 'immediately', 'sudden', 'impulse', 'spontaneous'];
    const plannedWords = ['plan', 'schedule', 'organize', 'prepare', 'later'];
    traits.impulsivity = this._wordFrequencyScore(textData, impulsiveWords, plannedWords);
    
    // Social Dominance (from language: "I", "my", "won", "best" vs "we", "us", "together")
    const dominanceWords = ['i', 'my', 'mine', 'won', 'best', 'lead', 'control'];
    const collaborativeWords = ['we', 'us', 'our', 'together', 'team', 'share'];
    traits.socialDominance = this._wordFrequencyScore(textData, dominanceWords, collaborativeWords);
    
    // Materialism (from likes: luxury brands, expensive items)
    const luxuryBrands = ['gucci', 'louis vuitton', 'rolex', 'ferrari', 'lamborghini'];
    const materialismScore = likesData.filter(like => 
      luxuryBrands.some(brand => like.name.toLowerCase().includes(brand))
    ).length;
    traits.materialistic = Math.min(100, materialismScore * 10);
    
    // Need for Cognition (complex language, educational interests)
    const avgWordLength = textData.split(/\s+/).reduce((sum, word) => 
      sum + word.length, 0) / (textData.split(/\s+/).length || 1);
    traits.needForCognition = Math.min(100, Math.round((avgWordLength - 4) * 20));
    
    // Innovativeness (early adopter signals, tech likes)
    const techWords = ['new', 'latest', 'innovation', 'tech', 'ai', 'crypto', 'beta'];
    traits.innovativeness = this._wordFrequencyScore(textData, techWords, []) * 1.5;
    
    // Privacy Concern (from language about privacy)
    const privacyWords = ['privacy', 'secure', 'encrypted', 'anonymous', 'vpn', 'data'];
    const privacyMentions = textData.toLowerCase().split(/\s+/).filter(word =>
      privacyWords.some(pw => word.includes(pw))
    ).length;
    traits.privacyConcern = Math.min(100, privacyMentions * 5);
    
    // Brand Loyalty (repeated mentions of same brands)
    traits.brandLoyalty = this._calculateBrandLoyalty(textData, likesData);
    
    return traits;
  }
  
  /**
   * LIFESTYLE MARKERS EXTRACTION
   * Infer socioeconomic status, life stage, habits from data
   */
  static async extractLifestyleMarkers(userData, feedData, imageData, likesData) {
    const markers = {};
    
    // Socioeconomic Status Inference
    const wealthSignals = this._detectWealthSignals(feedData, imageData, likesData);
    markers.socioeconomicStatus = wealthSignals.level;
    
    // Education Level (from language complexity, educational institutions liked)
    const educationalLikes = likesData.filter(like => 
      ['university', 'college', 'education', 'academy'].some(term =>
        like.name.toLowerCase().includes(term)
      )
    );
    const languageComplexity = this._assessLanguageComplexity(feedData);
    markers.educationLevel = this._inferEducation(educationalLikes.length, languageComplexity);
    
    // Career Stage (from age, language, patterns)
    markers.careerStage = this._inferCareerStage(userData, feedData);
    
    // Relationship Status (from language: "we", relationship pages liked)
    const relationshipWords = feedData.join(' ').toLowerCase()
      .match(/\b(my (boyfriend|girlfriend|partner|husband|wife|spouse))\b/g);
    const singleWords = feedData.join(' ').toLowerCase()
      .match(/\b(single|dating|looking for)\b/g);
    markers.relationshipStatus = relationshipWords?.length > singleWords?.length ? 
      'in_relationship' : 'single';
    
    // Parental Status
    const parentWords = ['kid', 'child', 'son', 'daughter', 'parent', 'baby', 'toddler'];
    const parentMentions = feedData.join(' ').toLowerCase().split(/\s+/).filter(word =>
      parentWords.some(pw => word.includes(pw))
    ).length;
    markers.parentalStatus = parentMentions > 5 ? 'parent' : 'non_parent';
    
    // Health Consciousness
    const healthWords = ['gym', 'workout', 'fitness', 'healthy', 'organic', 'vegan', 'diet'];
    const healthLikes = likesData.filter(like =>
      healthWords.some(hw => like.name.toLowerCase().includes(hw))
    ).length;
    markers.healthConsciousness = Math.min(100, healthLikes * 10);
    
    // Travel Frequency (from check-ins, travel-related posts)
    const travelWords = ['travel', 'trip', 'vacation', 'airport', 'flight', 'hotel'];
    const travelPosts = feedData.filter(post =>
      travelWords.some(tw => post.toLowerCase().includes(tw))
    ).length;
    markers.travelFrequency = this._categorizeTravelFrequency(travelPosts);
    
    // Dining Preferences
    const cuisines = ['italian', 'chinese', 'mexican', 'japanese', 'indian', 'thai', 'french'];
    markers.diningPreferences = likesData
      .filter(like => cuisines.some(c => like.name.toLowerCase().includes(c)))
      .map(like => like.name);
    
    return markers;
  }
  
  /**
   * SOCIAL GRAPH ANALYSIS
   * Calculate network metrics revealing influence and connections
   */
  static async analyzeSocialGraph(userId, friendsData, interactionsData) {
    // Build adjacency matrix
    const nodes = new Set([userId, ...friendsData.map(f => f.id)]);
    const edges = interactionsData.map(i => [i.from, i.to]);
    
    const graph = this._buildGraph(Array.from(nodes), edges);
    
    // Calculate metrics
    const metrics = {
      influenceScore: this._calculateInfluenceScore(graph, userId),
      bridgingCapital: this._calculateBridgingCapital(graph, userId),
      bondingCapital: this._calculateBondingCapital(graph, userId),
      networkDensity: this._calculateNetworkDensity(graph),
      eigenvectorCentrality: this._calculateEigenvectorCentrality(graph, userId),
      betweennessCentrality: this._calculateBetweennessCentrality(graph, userId),
      communities: this._detectCommunities(graph),
      echoChamberScore: this._calculateEchoChamberScore(graph, userId),
      polarizationIndex: this._calculatePolarizationIndex(graph)
    };
    
    return metrics;
  }
  
  /**
   * CROSS-MODAL CORRELATION
   * Find patterns across text, images, and behavior
   */
  static async findCrossModalCorrelations(userData) {
    const correlations = [];
    
    // Example: Travel photos + location check-ins + travel vocabulary
    const travelCorr = this._correlateTravelPatterns(userData);
    if (travelCorr.confidence > 0.7) correlations.push(travelCorr);
    
    // Example: Luxury items in photos + luxury brand likes + wealth language
    const wealthCorr = this._correlateWealthSignals(userData);
    if (wealthCorr.confidence > 0.7) correlations.push(wealthCorr);
    
    // Example: Health/fitness images + health likes + workout language
    const healthCorr = this._correlateHealthBehavior(userData);
    if (healthCorr.confidence > 0.7) correlations.push(healthCorr);
    
    // Example: Social gathering photos + social language + interaction frequency
    const socialCorr = this._correlateSocialBehavior(userData);
    if (socialCorr.confidence > 0.7) correlations.push(socialCorr);
    
    // Example: Late night posts + tired language + low engagement
    const fatigueCorr = this._correlateFatiguePatterns(userData);
    if (fatigueCorr.confidence > 0.7) correlations.push(fatigueCorr);
    
    return correlations;
  }
  
  /**
   * VULNERABILITY SCORING
   * Calculate exploitability and privacy risk metrics
   */
  static async calculateVulnerabilityProfile(userData, surveillanceData) {
    const profile = {};
    
    // Data Exposure Level
    const dataPoints = [
      userData.feedData?.length || 0,
      userData.likes?.length || 0,
      userData.albumsData?.length || 0,
      Object.keys(surveillanceData.visualProfile?.locations || {}).length,
      Object.keys(surveillanceData.visualProfile?.brands || {}).length
    ];
    profile.dataExposureLevel = Math.min(100, dataPoints.reduce((a, b) => a + b, 0) / 5);
    
    // Re-identification Risk
    const uniqueIdentifiers = [
      userData.location?.name,
      userData.hometown?.name,
      userData.birthday,
      userData.gender,
      ...(userData.languages || []).map(l => l.name)
    ].filter(Boolean).length;
    profile.reidentificationRisk = Math.min(100, uniqueIdentifiers * 15);
    
    // Profiling Depth
    const inferenceCount = Object.values(surveillanceData.inferredTraits || {}).length +
                           Object.values(surveillanceData.lifestyleMarkers || {}).length;
    profile.profilingDepth = Math.min(100, inferenceCount * 5);
    
    // Manipulation Susceptibility
    profile.manipulationSusceptibility = this._calculateManipulationRisk(
      surveillanceData.inferredTraits,
      surveillanceData.behavioralPatterns
    );
    
    // Privacy Awareness Score (inverse of privacy concern)
    profile.privacyAwarenessScore = 100 - (surveillanceData.inferredTraits?.privacyConcern || 50);
    
    // Opt-Out Difficulty (based on data breadth and depth)
    profile.optOutDifficulty = Math.min(100, 
      (profile.dataExposureLevel + profile.profilingDepth) / 2
    );
    
    return profile;
  }
  
  // ============== HELPER METHODS ==============
  
  static _calculateTimeVariance(times) {
    if (times.length < 2) return 100;
    const hours = times.map(t => t.getHours());
    const mean = hours.reduce((a, b) => a + b, 0) / hours.length;
    const variance = hours.reduce((sum, h) => sum + Math.pow(h - mean, 2), 0) / hours.length;
    return Math.min(100, variance * 2);
  }
  
  static _calculateEntropy(frequencies) {
    const total = frequencies.reduce((a, b) => a + b, 0);
    return frequencies.reduce((entropy, freq) => {
      const p = freq / total;
      return entropy - (p * Math.log(p));
    }, 0);
  }
  
  static _formatTimeRange(hour) {
    const ranges = {
      '0-5': 'Late Night (12am-6am)',
      '6-11': 'Morning (6am-12pm)',
      '12-17': 'Afternoon (12pm-6pm)',
      '18-23': 'Evening (6pm-12am)'
    };
    for (const [range, label] of Object.entries(ranges)) {
      const [start, end] = range.split('-').map(Number);
      if (hour >= start && hour <= end) return label;
    }
    return 'Unknown';
  }
  
  static _wordFrequencyScore(text, positiveWords, negativeWords) {
    const tokens = text.toLowerCase().split(/\s+/);
    const posCount = tokens.filter(t => positiveWords.some(pw => t.includes(pw))).length;
    const negCount = tokens.filter(t => negativeWords.some(nw => t.includes(nw))).length;
    const total = posCount + negCount || 1;
    return Math.round((posCount / total) * 100);
  }
  
  static _detectWealthSignals(feedData, imageData, likesData) {
    let wealthScore = 0;
    
    // Luxury brands
    const luxuryBrands = ['gucci', 'prada', 'rolex', 'louis vuitton', 'ferrari'];
    wealthScore += likesData.filter(like =>
      luxuryBrands.some(brand => like.name.toLowerCase().includes(brand))
    ).length * 10;
    
    // Travel to expensive destinations
    const expensiveLocations = ['dubai', 'monaco', 'maldives', 'paris', 'switzerland'];
    wealthScore += feedData.filter(post =>
      expensiveLocations.some(loc => post.toLowerCase().includes(loc))
    ).length * 15;
    
    // Visual signals from images (would need actual CV analysis)
    // Placeholder: assume some images analyzed for luxury items
    wealthScore += (imageData.luxuryItemCount || 0) * 5;
    
    const level = wealthScore > 100 ? 'high' : wealthScore > 50 ? 'middle' : 'low';
    return { score: Math.min(100, wealthScore), level };
  }
  
  static _assessLanguageComplexity(feedData) {
    const text = feedData.join(' ');
    const words = text.split(/\s+/);
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / (words.length || 1);
    const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
    const lexicalDiversity = uniqueWords / (words.length || 1);
    
    return (avgWordLength + lexicalDiversity * 100) / 2;
  }
  
  static _inferEducation(educationalLikes, languageComplexity) {
    const score = educationalLikes * 10 + languageComplexity;
    if (score > 70) return 'graduate';
    if (score > 50) return 'undergraduate';
    if (score > 30) return 'high_school';
    return 'unknown';
  }
  
  static _inferCareerStage(userData, feedData) {
    const age = userData.age_range?.min || 25;
    const careerWords = ['work', 'job', 'career', 'promotion', 'boss', 'office'];
    const careerMentions = feedData.join(' ').toLowerCase().split(/\s+/)
      .filter(w => careerWords.some(cw => w.includes(cw))).length;
    
    if (age < 25) return 'student';
    if (age < 35 && careerMentions < 10) return 'early_career';
    if (age < 50 && careerMentions > 10) return 'mid_career';
    if (age >= 50) return 'senior_career';
    return 'unknown';
  }
  
  static _categorizeTravelFrequency(travelPosts) {
    if (travelPosts > 20) return 'frequent';
    if (travelPosts > 10) return 'regular';
    if (travelPosts > 3) return 'occasional';
    return 'rare';
  }
  
  static _calculateBrandLoyalty(textData, likesData) {
    // Count repeated brand mentions
    const brands = {};
    likesData.forEach(like => {
      const name = like.name.toLowerCase();
      brands[name] = (brands[name] || 0) + 1;
    });
    
    const repeatedBrands = Object.values(brands).filter(count => count > 1).length;
    return Math.min(100, repeatedBrands * 10);
  }
  
  static _buildGraph(nodes, edges) {
    const adjacency = {};
    nodes.forEach(node => adjacency[node] = []);
    edges.forEach(([from, to]) => {
      if (adjacency[from]) adjacency[from].push(to);
      if (adjacency[to]) adjacency[to].push(from);
    });
    return adjacency;
  }
  
  static _calculateInfluenceScore(graph, userId) {
    // Simple influence = number of connections * avg of their connections
    const userConnections = graph[userId]?.length || 0;
    const secondDegree = (graph[userId] || []).reduce((sum, neighbor) => {
      return sum + (graph[neighbor]?.length || 0);
    }, 0);
    return Math.min(100, Math.round(userConnections + (secondDegree / 10)));
  }
  
  static _calculateBridgingCapital(graph, userId) {
    // Measures connections to different clusters
    const connections = graph[userId] || [];
    if (connections.length < 2) return 0;
    
    // Simple heuristic: diversity of second-degree connections
    const secondDegreeSet = new Set();
    connections.forEach(neighbor => {
      (graph[neighbor] || []).forEach(n => secondDegreeSet.add(n));
    });
    
    return Math.min(100, Math.round((secondDegreeSet.size / connections.length) * 10));
  }
  
  static _calculateBondingCapital(graph, userId) {
    // Measures strength of close ties
    const connections = graph[userId] || [];
    if (connections.length === 0) return 0;
    
    // How many of user's friends are also friends with each other?
    let mutualConnections = 0;
    for (let i = 0; i < connections.length; i++) {
      for (let j = i + 1; j < connections.length; j++) {
        if (graph[connections[i]]?.includes(connections[j])) {
          mutualConnections++;
        }
      }
    }
    
    const maxPossible = (connections.length * (connections.length - 1)) / 2;
    return Math.round((mutualConnections / (maxPossible || 1)) * 100);
  }
  
  static _calculateNetworkDensity(graph) {
    const nodes = Object.keys(graph);
    const edges = Object.values(graph).reduce((sum, neighbors) => sum + neighbors.length, 0) / 2;
    const maxPossibleEdges = (nodes.length * (nodes.length - 1)) / 2;
    return Math.round((edges / (maxPossibleEdges || 1)) * 100);
  }
  
  static _calculateEigenvectorCentrality(graph, userId) {
    // Simplified: influence score weighted by neighbors' influence
    return this._calculateInfluenceScore(graph, userId);
  }
  
  static _calculateBetweennessCentrality(graph, userId) {
    // Simplified: estimate based on unique paths through user
    const connections = graph[userId] || [];
    return Math.min(100, connections.length * 5);
  }
  
  static _detectCommunities(graph) {
    // Connected-components based community detection.
    // Returns an empty list when there is no graph data.
    const nodes = Object.keys(graph);
    if (nodes.length === 0) return [];
    const visited = new Set();
    const communities = [];
    for (const node of nodes) {
      if (visited.has(node)) continue;
      const queue = [node];
      visited.add(node);
      const members = [];
      while (queue.length) {
        const current = queue.shift();
        members.push(current);
        for (const neighbor of (graph[current] || [])) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      if (members.length > 1) communities.push(`community_${communities.length + 1}`);
    }
    return communities;
  }
  
  static _calculateEchoChamberScore(graph, userId) {
    // Echo chamber is approximated by how tightly the user's connections
    // are interconnected (high clustering = more closed network).
    // With no connection data available this is honestly 0, not random.
    const connections = graph[userId] || [];
    if (connections.length < 2) return 0;
    return this._calculateBondingCapital(graph, userId);
  }

  static _calculatePolarizationIndex(graph) {
    // Approximate network polarization from overall density.
    // Returns 0 when there is no edge data instead of a random value.
    const nodes = Object.keys(graph);
    if (nodes.length < 2) return 0;
    return this._calculateNetworkDensity(graph);
  }
  
  static _corpusText(userData) {
    const parts = [];
    (userData.feedData || []).forEach(p => {
      if (typeof p === 'string') parts.push(p);
      else if (p && (p.message || p.text || p.story)) parts.push(p.message || p.text || p.story);
    });
    return parts.join(' ').toLowerCase();
  }

  static _likesText(userData) {
    return (userData.likes || []).map(l => (l && l.name ? l.name : '')).join(' ').toLowerCase();
  }

  static _countHits(text, words) {
    let n = 0;
    for (const w of words) { if (text.includes(w)) n++; }
    return n;
  }

  static _correlateTravelPatterns(userData) {
    // Confidence derived from actual travel references in the user's data.
    const text = this._corpusText(userData);
    const likes = this._likesText(userData);
    const hits = this._countHits(text, ['travel', 'trip', 'vacation', 'flight', 'airport', 'hotel', 'beach', 'tour', 'abroad', 'passport'])
      + this._countHits(likes, ['airline', 'airport', 'travel', 'tourism']);
    return {
      pattern: 'frequent_traveler',
      confidence: Number(Math.min(0.95, hits * 0.12).toFixed(2)),
      sources: ['posts', 'likes'],
      insight: 'Travel-related language and interests detected; frequency scales with the number of references found.',
      sensitivity: 'medium'
    };
  }
  
  static _correlateWealthSignals(userData) {
    const text = this._corpusText(userData);
    const likes = this._likesText(userData);
    const hits = this._countHits(likes, ['gucci', 'prada', 'rolex', 'louis vuitton', 'ferrari', 'lamborghini', 'porsche'])
      + this._countHits(text, ['luxury', 'designer', 'first class', 'penthouse', 'yacht']);
    return {
      pattern: 'high_socioeconomic_status',
      confidence: Number(Math.min(0.95, hits * 0.15).toFixed(2)),
      sources: ['likes', 'text'],
      insight: 'Luxury brand interests and affluent language detected; confidence scales with the number of indicators.',
      sensitivity: 'high'
    };
  }
  
  static _correlateHealthBehavior(userData) {
    const text = this._corpusText(userData);
    const likes = this._likesText(userData);
    const hits = this._countHits(text, ['gym', 'workout', 'fitness', 'run', 'yoga', 'healthy', 'vegan', 'organic', 'diet'])
      + this._countHits(likes, ['gym', 'fitness', 'yoga', 'nutrition']);
    return {
      pattern: 'health_conscious',
      confidence: Number(Math.min(0.95, hits * 0.12).toFixed(2)),
      sources: ['posts', 'likes'],
      insight: 'Fitness and healthy-lifestyle references detected; confidence scales with the number of indicators.',
      sensitivity: 'low'
    };
  }
  
  static _correlateSocialBehavior(userData) {
    const text = this._corpusText(userData);
    const hits = this._countHits(text, ['party', 'friends', 'event', 'gathering', 'night out', 'celebrate', 'hangout', 'concert']);
    const postVolume = (userData.feedData || []).length;
    const confidence = Math.min(0.95, hits * 0.1 + Math.min(0.3, postVolume / 200));
    return {
      pattern: 'highly_social',
      confidence: Number(confidence.toFixed(2)),
      sources: ['posts'],
      insight: 'Social-event language and posting volume suggest social activity; confidence scales with detected signals.',
      sensitivity: 'medium'
    };
  }
  
  static _correlateFatiguePatterns(userData) {
    const times = (userData.feedData || [])
      .map(p => (p && p.created_time) ? new Date(p.created_time) : null)
      .filter(t => t && !isNaN(t));
    const lateNight = times.filter(t => { const h = t.getHours(); return h >= 23 || h < 5; }).length;
    const ratio = times.length ? lateNight / times.length : 0;
    const tired = this._countHits(this._corpusText(userData), ['tired', 'exhausted', "can't sleep", 'insomnia', 'no sleep', 'awake', 'restless']);
    const confidence = Math.min(0.95, ratio * 1.5 + tired * 0.1);
    return {
      pattern: 'irregular_sleep',
      confidence: Number(confidence.toFixed(2)),
      sources: ['posting_times', 'text'],
      insight: 'Late-night posting and fatigue language suggest irregular sleep; confidence scales with detected signals.',
      sensitivity: 'medium'
    };
  }
  
  static _calculateManipulationRisk(traits, patterns) {
    let risk = 0;

    // High impulsivity + low privacy concern = vulnerable
    if (traits?.impulsivity > 70 && traits?.privacyConcern < 30) risk += 30;

    // Strong habits = predictable = targetable
    if (patterns?.habitStrength > 80) risk += 20;

    // High materialism = susceptible to consumer targeting
    if (traits?.materialistic > 60) risk += 20;

    // Low need for cognition = less likely to scrutinise messaging
    if (traits?.needForCognition < 40) risk += 15;

    // High risk tolerance = more responsive to urgency/scarcity tactics
    if (traits?.riskTolerance > 70) risk += 15;

    return Math.min(100, risk);
  }
}

module.exports = SurveillanceEngine;