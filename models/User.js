// models/User.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Image schema for representing images from Facebook
 */
const ImageSchema = new Schema({
  height: { type: Number, default: 0 },
  width: { type: Number, default: 0 },
  source: { type: String, default: '' }
}, { _id: false });

/**
 * Photo schema for representing photos from Facebook
 */
const PhotoSchema = new Schema({
  id: { type: String },
  images: [ImageSchema],
  url: { type: String, default: '' },
  created_time: { type: Date },
  name: { type: String }
}, { _id: false });

/**
 * Album schema for representing albums from Facebook
 */
const AlbumSchema = new Schema({
  id: { type: String },
  name: { type: String, default: 'Unnamed Album' },
  count: { type: Number, default: 0 },
  created_time: { type: Date },
  photos: {
    data: [PhotoSchema],
    paging: Schema.Types.Mixed
  }
}, { _id: false });

/**
 * ProcessedAlbum schema to track which albums have been analyzed
 */
const ProcessedAlbumSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, default: 'Unnamed Album' },
  processedAt: { type: Date, default: Date.now }
}, { _id: false });

/**
 * Facebook Page Like schema
 */
const LikeSchema = new Schema({
  id: { type: String },
  name: { type: String },
  category: { type: String },
  created_time: { type: Date }
}, { _id: false });

/**
 * Favorite Team schema
 */
const TeamSchema = new Schema({
  id: { type: String },
  name: { type: String }
}, { _id: false });

/**
 * Language schema
 */
const LanguageSchema = new Schema({
  id: { type: String },
  name: { type: String }
}, { _id: false });

/**
 * Word Count schema
 */
const WordCountSchema = new Schema({
  word: { type: String },
  count: { type: Number, default: 0 }
}, { _id: false });

/**
 * Personality Scores schema
 */
const PersonalityScoresSchema = new Schema({
  extroversion: { type: Number, default: 50, min: 0, max: 100 },
  neuroticism: { type: Number, default: 50, min: 0, max: 100 },
  agreeableness: { type: Number, default: 50, min: 0, max: 100 },
  conscientiousness: { type: Number, default: 50, min: 0, max: 100 },
  openness: { type: Number, default: 50, min: 0, max: 100 },
  confidence: { type: Number, default: 0, min: 0, max: 100 }
}, { _id: false });

/**
 * Sentiment Result schema
 */
const SentimentResultSchema = new Schema({
  score: { type: Number, default: 50 },
  comparative: { type: Number },
  tokens: [String],
  words: [String],
  positive: [String],
  negative: [String]
}, { _id: false });

/**
 * Location schema
 */
const LocationSchema = new Schema({
  id: { type: String },
  name: { type: String, default: '' }
}, { _id: false });

/**
 * Age Range schema
 */
const AgeRangeSchema = new Schema({
  min: { type: Number },
  max: { type: Number }
}, { _id: false });

/**
 * Picture schema - supports both object and string formats from Facebook
 */
const PictureSchema = new Schema({
  data: {
    height: { type: Number },
    is_silhouette: { type: Boolean },
    url: { type: String },
    width: { type: Number }
  }
}, { _id: false });

/**
 * Main User schema
 */
const UserSchema = new Schema({
  // Basic identity information
  id: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    index: true
  },
  name: { 
    type: String,
    trim: true,
    default: 'User'
  },
  email: { 
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  birthday: { 
    type: String,
    default: ''
  },
  age_range: { 
    type: AgeRangeSchema,
    default: () => ({})
  },
  gender: { 
    type: String,
    enum: ['male', 'female', 'other', ''],
    default: ''
  },
  
  // Location information
  hometown: { 
    type: LocationSchema,
    default: () => ({})
  },
  location: { 
    type: LocationSchema,
    default: () => ({})
  },
  
  // Social connections and interests
  likes: { 
    type: [LikeSchema],
    default: []
  },
  groups: { 
    type: [Schema.Types.Mixed],
    default: []
  },
  languages: { 
    type: [LanguageSchema],
    default: []
  },
  favorite_teams: { 
    type: [TeamSchema],
    default: []
  },
  favorite_athletes: { 
    type: [TeamSchema],
    default: []
  },
  businesses: { 
    type: [Schema.Types.Mixed],
    default: []
  },
  
  // Photo and album data
  albumsData: { 
    type: [AlbumSchema],
    default: []
  },
  processedAlbums: {
    type: [ProcessedAlbumSchema],
    default: []
  },
  
  // Content and feed data
  feedData: { 
    type: [Schema.Types.Mixed],
    default: []
  },
  
  // Profile picture - can be either object or string
  picture: {
    type: Schema.Types.Mixed,
    default: null
  },
  
  // Analysis results
  personalityScores: { 
    type: PersonalityScoresSchema,
    default: () => ({})
  },
  mostCommonWords: { 
    type: [WordCountSchema],
    default: []
  },
  sentimentResult: { 
    type: SentimentResultSchema,
    default: () => ({ score: 50 })
  },
  
  // Generated descriptions
  pD: { 
    type: String, 
    default: ''
  },
  uD: { 
    type: String, 
    default: ''
  },
  
  // Interest information
  mostCommonLikes: { 
    type: String, 
    default: ''
  },
  areaOfInterest: { 
    type: String, 
    default: 'General'
  },
  
  // Additional analysis fields
  engagementScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  interestDiversity: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  readability: {
    type: Schema.Types.Mixed,
    default: () => ({
      fleschKincaid: 50,
      syllablesPerWord: 0,
      wordsPerSentence: 0
    })
  },
  textStatistics: {
    type: Schema.Types.Mixed,
    default: () => ({
      totalWords: 0,
      uniqueWords: 0,
      vocabularyDiversity: 0,
      sentences: 0,
      characters: 0
    })
  },
  // Add in the "Basic identity information" section (around line 60):
  facebookId: { 
    type: String, 
    unique: true, 
    sparse: true,
    trim: true,
    index: true
  },

  // Processing status tracking - NEW FIELD
  status: {
    type: String,
    enum: ['pending', 'processing', 'complete', 'error', 'active'],
    default: 'pending'
  },
  error: {
    type: String,
    default: null
  },
  
  // Tracking information
  lastUpdated: { 
    type: Date, 
    default: Date.now
  },
  lastAnalyzed: {
    type: Date,
    default: null
  },
  analysisVersion: {
    type: Number,
    default: 1
  },
  
  // Settings
  settings: {
    type: Schema.Types.Mixed,
    default: () => ({
      privacy: {
        profileVisibility: 'private',
        shareInsights: false,
        allowDataCollection: true,
        anonymizeData: true
      },
      notifications: {
        emailAlerts: true,
        analysisUpdates: true,
        weeklyDigest: false,
        marketingEmails: false
      },
      analysis: {
        refreshFrequency: 'weekly',
        includeImages: true,
        maxImageProcessing: 25,
        languagePreference: 'auto',
        detailedReports: true
      },
      display: {
        theme: 'dark',
        compactMode: false,
        animations: true,
        fontSize: 'medium'
      },
      export: {
        autoBackup: false,
        backupFrequency: 'monthly',
        includeRawData: false,
        format: 'both'
      },
      security: {
        twoFactorAuth: false,
        sessionTimeout: 24,
        loginAlerts: true,
        dataRetention: '3months'
      }
    })
  },
  
  // Authentication info
  authMethod: {
    type: String,
    enum: ['facebook', 'google', 'email'],
    default: 'facebook'
  },
  ipAddress: {
    type: String,
    default: ''
  },
  userAgent: {
    type: String,
    default: ''
  },
  loginCount: {
    type: Number,
    default: 0
  },
  lastLoginDate: {
    type: Date,
    default: null
  },
  registrationDate: {
    type: Date,
    default: Date.now
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  }
}, { 
  timestamps: true,
  versionKey: false,
  // Add collation for case-insensitive queries
  collation: { locale: 'en', strength: 2 }
});



// Add these fields to your existing UserSchema
const SurveillanceDataSchema = new Schema({
  // Behavioral Rhythms
  behavioralPatterns: {
    postingCycle: [{
      dayOfWeek: Number,
      hourOfDay: Number,
      frequency: Number,
      consistency: Number
    }],
    circadianAlignment: Number, // 0-100
    habitStrength: Number, // 0-100
    activeHours: [Number],
    peakActivityTime: String
  },
  
  // Interaction Intelligence
  interactions: {
    reciprocityScore: Number,
    dwellTimeAvg: Number,
    scrollSpeed: Number,
    completionRate: Number,
    engagementDepth: Number,
    responseLatency: Number
  },
  
  // Psychographic Inference
  inferredTraits: {
    riskTolerance: Number,
    impulsivity: Number,
    socialDominance: Number,
    needForCognition: Number,
    materialistic: Number,
    brandLoyalty: Number,
    innovativeness: Number,
    privacyConcern: Number
  },
  
  // Lifestyle Indicators
  lifestyleMarkers: {
    socioeconomicStatus: String, // 'low', 'middle', 'high'
    educationLevel: String,
    careerStage: String,
    relationshipStatus: String,
    parentalStatus: String,
    healthConsciousness: Number,
    travelFrequency: String,
    diningPreferences: [String]
  },
  
  // Visual Intelligence
  visualProfile: {
    locations: [{
      name: String,
      frequency: Number,
      type: String, // 'home', 'work', 'leisure'
      coordinates: { lat: Number, lng: Number }
    }],
    brands: [{ name: String, category: String, frequency: Number }],
    activities: [{ type: String, frequency: Number }],
    socialCircle: [{
      faceId: String,
      frequency: Number,
      relationship: String
    }],
    wealthSignals: [String],
    travelPatterns: [{
      destination: String,
      date: Date,
      luxuryLevel: String
    }]
  },
  
  // Social Graph
  socialGraph: {
    influenceScore: Number,
    bridgingCapital: Number,
    bondingCapital: Number,
    networkDensity: Number,
    clusterCoefficient: Number,
    eigenvectorCentrality: Number,
    betweennessCentrality: Number,
    communities: [String],
    echoChamberScore: Number,
    polarizationIndex: Number
  },
  
  // Cross-Modal Intelligence
  correlations: [{
    pattern: String,
    confidence: Number,
    sources: [String],
    insight: String,
    sensitivity: String // 'low', 'medium', 'high', 'critical'
  }],
  
  // Exploitability Metrics
  vulnerabilityProfile: {
    dataExposureLevel: Number, // 0-100
    reidentificationRisk: Number,
    profilingDepth: Number,
    manipulationSusceptibility: Number,
    privacyAwarenessScore: Number,
    optOutDifficulty: Number
  },
  
  // Tracking Metadata
  surveillanceMetadata: {
    totalDataPoints: Number,
    lastFullAnalysis: Date,
    inferenceConfidence: Number,
    dataFreshness: Number,
    crossModalCorrelations: Number
  }
}, { _id: false });

// Add to main UserSchema
UserSchema.add({
  surveillance: { type: SurveillanceDataSchema, default: () => ({}) }
});

/**
 * Pre-save middleware to handle picture field format
 * This ensures the picture field is always saved correctly
 * regardless of the format received from Facebook
 */
UserSchema.pre('save', function(next) {
  // Handle picture: normalize it if it's an object with data.url or a string URL
  try {
    if (this.picture) {
      // If it's a string but should be an object according to our schema
      if (typeof this.picture === 'string') {
        this.picture = { data: { url: this.picture } };
      } 
      // If it has a nested url but wrong structure
      else if (typeof this.picture === 'object' && this.picture.data?.url) {
        // Already in the correct format, keep it
      }
      // Handle other cases - set to a default empty object
      else if (typeof this.picture === 'object' && !this.picture.data) {
        this.picture = { data: { url: '' } };
      }
    }
  } catch (error) {
    console.error('Error processing picture field:', error);
    // Set a default in case of error
    this.picture = { data: { url: '' } };
  }
  
  // Update lastUpdated timestamp
  this.lastUpdated = new Date();
  
  // If this is a save after login, update login info
  if (this.isModified('lastLoginDate')) {
    this.loginCount = (this.loginCount || 0) + 1;
  }
  
  next();
});

/**
 * Method to get properly formatted picture URL
 * This makes it easy to always get the URL regardless of the internal format
 */
UserSchema.methods.getPictureUrl = function() {
  if (!this.picture) return '';
  
  if (typeof this.picture === 'string') {
    return this.picture;
  }
  
  if (typeof this.picture === 'object') {
    if (this.picture.data && this.picture.data.url) {
      return this.picture.data.url;
    }
  }
  
  return '';
};

/**
 * Virtual property to always get picture URL regardless of storage format
 */
UserSchema.virtual('pictureUrl').get(function() {
  return this.getPictureUrl();
});

/**
 * Virtual property to check if user needs processing
 */
UserSchema.virtual('needsProcessing').get(function() {
  return !this.personalityScores || 
         !this.pD || 
         this.status === 'pending' || 
         this.status === 'error';
});

/**
 * Virtual property to check if analysis is complete
 */
UserSchema.virtual('analysisComplete').get(function() {
  return this.personalityScores && 
         this.pD && 
         this.status === 'complete';
});

/**
 * Method to mark user as processing
 */
UserSchema.methods.markAsProcessing = function() {
  this.status = 'processing';
  this.lastUpdated = new Date();
  return this.save();
};

/**
 * Method to mark user as complete
 */
UserSchema.methods.markAsComplete = function() {
  this.status = 'complete';
  this.lastAnalyzed = new Date();
  this.lastUpdated = new Date();
  return this.save();
};

/**
 * Method to mark user as error
 */
UserSchema.methods.markAsError = function(errorMessage) {
  this.status = 'error';
  this.error = errorMessage;
  this.lastUpdated = new Date();
  return this.save();
};

/**
 * Indexes for better performance
 */
UserSchema.index({ 'name': 1 });
UserSchema.index({ 'email': 1 });
UserSchema.index({ 'lastUpdated': -1 });
UserSchema.index({ 'status': 1 });
UserSchema.index({ 'createdAt': -1 });

/**
 * Create and export the User model
 */
const User = mongoose.model('User', UserSchema);
module.exports = User;