// controllers/userController.js

const User = require('../models/User');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const natural = require("natural");
const TfIdf = natural.TfIdf;

// Define CSV file path
const csvFilePath = path.join(__dirname, '../extras/mypersonality_final.csv');

// Declare stopwords outside the function for reusability and performance
const stopwords = ["the", "is", "in", "to", "a", "for", "on", "with", "as", "by", "an", "at", "and"];

// Check if CSV file exists
fs.access(csvFilePath, fs.constants.F_OK, (err) => {
  if (err) {
    console.error('CSV file does not exist at:', csvFilePath);
  } else {
    console.log('CSV file found at:', csvFilePath);
  }
});

// Preprocess text (clean and tokenize)
function preprocessText(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Replace non-word characters with a space
    .split(/\s+/)              // Split by any whitespace
    .filter(token => token && !stopwords.includes(token));  // Remove stopwords and empty tokens
}

// Function to calculate text similarity using cosine similarity
function calculateCosineSimilarity(text1, text2) {
  const tfidf = new TfIdf();
  tfidf.addDocument(text1);
  tfidf.addDocument(text2);

  const vector1 = tfidf.documents[0];
  const vector2 = tfidf.documents[1];

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const term in vector1) {
    dotProduct += (vector1[term] || 0) * (vector2[term] || 0);
    normA += Math.pow(vector1[term] || 0, 2);
    normB += Math.pow(vector2[term] || 0, 2);
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  return (normA === 0 || normB === 0) ? 0 : dotProduct / (normA * normB);  // Avoid division by zero
}

// Load personality model (mypersonality_final.csv)
async function loadPersonalityModel() {
  try {
    const csvData = [];
    return new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (row) => {
          csvData.push(row);
        })
        .on('end', () => resolve(csvData))
        .on('error', (error) => {
          console.error('Error reading CSV file:', error);
          reject(error);
        });
    });
  } catch (error) {
    console.error("Error loading personality model:", error);
    throw new Error("Error loading model data.");
  }
}

// Function to read user data from the database
async function readUserData(userId) {
  try {
    const user = await User.findOne({ id: userId });
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  } catch (error) {
    console.error('Error fetching user data:', error);
    throw new Error('Error fetching data from the database');
  }
}

// Function to compare user data with the trained model
async function compareUserDataWithModel(user) {
  try {
    // Load the personality model
    const personalityModel = await loadPersonalityModel();

    // Check if user feed data is available and not empty
    const userText = (user.feedData || []).map(feed => feed.message || "").join(" ").toLowerCase();

    const defaultScores = {
      extroversion: 50,
      neuroticism: 50,
      agreeableness: 50,
      conscientiousness: 50,
      openness: 50,
      confidence: 0
    };

    if (!userText || userText.trim().length === 0) {
      console.error('User feed data is empty.');
      return defaultScores;
    }

    // Preprocess the user's text ONCE and build a frequency vector.
    // (Previously a TF-IDF model was rebuilt for every CSV row, which is what
    // caused the multi-hundred-MB memory spike during analysis.)
    const userTokens = preprocessText(userText);
    if (userTokens.length === 0) return defaultScores;

    const userFreq = new Map();
    for (const t of userTokens) userFreq.set(t, (userFreq.get(t) || 0) + 1);
    let userMagSq = 0;
    for (const c of userFreq.values()) userMagSq += c * c;
    const userMag = Math.sqrt(userMagSq);

    // Lightweight cosine similarity of one status row against the user vector.
    const similarityToUser = (statusText) => {
      const tokens = preprocessText(statusText || "");
      if (tokens.length === 0) return 0;
      const rowFreq = new Map();
      for (const t of tokens) rowFreq.set(t, (rowFreq.get(t) || 0) + 1);
      let dot = 0;
      let rowMagSq = 0;
      for (const [t, c] of rowFreq) {
        rowMagSq += c * c;
        const fc = userFreq.get(t);
        if (fc) dot += fc * c;
      }
      if (dot === 0) return 0;
      return dot / (userMag * Math.sqrt(rowMagSq));
    };

    // Collect matches above threshold.
    const matches = [];
    personalityModel.forEach((row) => {
      if (!row.STATUS) return;
      const similarity = similarityToUser(row.STATUS);
      if (similarity > 0.1) {
        matches.push({
          similarity,
          extroversion: parseFloat(row.sEXT) || 0,
          neuroticism: parseFloat(row.sNEU) || 0,
          agreeableness: parseFloat(row.sAGR) || 0,
          conscientiousness: parseFloat(row.sCON) || 0,
          openness: parseFloat(row.sOPN) || 0
        });
      }
    });

    // Average only the strongest matches so a few clear signals aren't drowned
    // out by thousands of weak ones (which regressed every trait to the mean).
    const TOP_MATCHES = 50;
    matches.sort((a, b) => b.similarity - a.similarity);
    const top = matches.slice(0, TOP_MATCHES);

    if (top.length === 0) {
      console.log('Calculated personality scores (0-100 scale):', defaultScores);
      return defaultScores;
    }

    let weightSum = 0;
    const totals = { extroversion: 0, neuroticism: 0, agreeableness: 0, conscientiousness: 0, openness: 0 };
    for (const m of top) {
      const weight = m.similarity * m.similarity;
      weightSum += weight;
      totals.extroversion += m.extroversion * weight;
      totals.neuroticism += m.neuroticism * weight;
      totals.agreeableness += m.agreeableness * weight;
      totals.conscientiousness += m.conscientiousness * weight;
      totals.openness += m.openness * weight;
    }

    // CSV scores are 1-5 -> map to 0-100.
    const toScale = (v) => Math.round(Math.max(0, Math.min(100, (((v / weightSum) - 1) / 4) * 100)));
    const avgSimilarity = top.reduce((s, m) => s + m.similarity, 0) / top.length;
    const coverage = Math.min(1, top.length / TOP_MATCHES);

    const personalityScores = {
      extroversion: toScale(totals.extroversion),
      neuroticism: toScale(totals.neuroticism),
      agreeableness: toScale(totals.agreeableness),
      conscientiousness: toScale(totals.conscientiousness),
      openness: toScale(totals.openness),
      confidence: Math.round(Math.min(100, coverage * avgSimilarity * 200))
    };

    console.log(`Personality analysis: ${matches.length} candidate matches, using top ${top.length}, confidence ${personalityScores.confidence}`);
    console.log('Calculated personality scores (0-100 scale):', personalityScores);
    return personalityScores;
  } catch (error) {
    console.error('Error comparing user data with personality model:', error);
    return {
      extroversion: 50,
      neuroticism: 50,
      agreeableness: 50,
      conscientiousness: 50,
      openness: 50,
      confidence: 0
    };
  }
}

// Export functions
module.exports = { readUserData, compareUserDataWithModel };
