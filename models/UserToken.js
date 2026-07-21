// models/UserToken.js

const mongoose = require('mongoose');

const userTokenSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true,
    index: true
  },
  accessToken: { 
    type: String, 
    required: true,
    index: true
  },
  expiresAt: { 
    type: Date 
  },
  lastUsed: {
    type: Date,
    default: Date.now
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  isValid: {
    type: Boolean,
    default: true
  },
  revokedAt: {
    type: Date
  }
}, {
  timestamps: true
});

const UserToken = mongoose.model('UserToken', userTokenSchema);

module.exports = UserToken;
