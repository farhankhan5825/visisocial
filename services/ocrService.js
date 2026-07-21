// services/ocrService.js
const vision = require('@google-cloud/vision');
const axios = require('axios');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const cache = require('../utils/cache');

// Initialize Google Cloud Vision client
let visionClient = null;

try {
  // Option 1: Using service account JSON file
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    visionClient = new vision.ImageAnnotatorClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });
  } 
  // Option 2: Using credentials from environment variable
  else if (process.env.GOOGLE_CLOUD_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CLOUD_CREDENTIALS_JSON);
    visionClient = new vision.ImageAnnotatorClient({
      credentials: credentials
    });
  }
  
  if (visionClient) {
    logger.info('✅ Google Cloud Vision API initialized');
  } else {
    logger.warn('⚠️ Google Cloud Vision API not configured, will use Tesseract fallback');
  }
} catch (error) {
  logger.error(`Failed to initialize Google Cloud Vision: ${error.message}`);
}

/**
 * Extract text using Google Cloud Vision API (Primary method)
 * @param {string} imageUrl - URL of the image
 * @returns {Promise<Object|null>} Extracted text with metadata
 */
async function extractTextWithGoogleVision(imageUrl) {
  if (!visionClient) {
    throw new Error('Google Cloud Vision not initialized');
  }
  
  try {
    logger.debug(`Using Google Vision API for: ${imageUrl.substring(0, 50)}...`);
    
    // Check cache first
    const cacheKey = `ocr_gv_${Buffer.from(imageUrl).toString('base64').substring(0, 50)}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.debug('Using cached Google Vision result');
      return cached;
    }
    
    // Download image
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 50 * 1024 * 1024
    });
    
    const imageBuffer = Buffer.from(response.data);
    
    // Optimize image size for API (max 10MB, resize if needed)
    let processedBuffer = imageBuffer;
    if (imageBuffer.length > 10 * 1024 * 1024) {
      logger.debug('Image too large, resizing...');
      processedBuffer = await sharp(imageBuffer)
        .resize(3000, 3000, { fit: 'inside', withoutEnlargement: false })
        .jpeg({ quality: 90 })
        .toBuffer();
    }
    
    // Perform text detection
    const [result] = await visionClient.textDetection({
      image: { content: processedBuffer }
    });
    
    const detections = result.textAnnotations;
    
    if (!detections || detections.length === 0) {
      logger.debug('No text detected by Google Vision');
      return null;
    }
    
    // First annotation is the full text
    const fullText = detections[0].description;
    
    // Calculate confidence (Google Vision doesn't provide overall confidence)
    // We'll use the presence of detected text as high confidence
    const confidence = 95; // Google Vision is typically 90-98% accurate
    
    // Get individual words for word count
    const words = detections.slice(1); // Skip first (full text)
    
    // Detect language
    const detectedLanguages = result.textAnnotations[0]?.locale 
      ? [result.textAnnotations[0].locale] 
      : ['en'];
    
    // Clean and normalize text
    const cleanedText = fullText
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (cleanedText.length < 3) {
      logger.debug('Text too short, likely noise');
      return null;
    }
    
    const resultData = {
      text: cleanedText,
      confidence: confidence,
      wordCount: words.length,
      language: detectedLanguages[0],
      method: 'google_vision',
      boundingBoxes: words.map(w => w.boundingPoly), // For potential future use
      detectedAt: new Date()
    };
    
    // Cache result for 7 days
    await cache.set(cacheKey, resultData, 7 * 24 * 60 * 60 * 1000);
    
    logger.debug(`Google Vision extracted ${cleanedText.length} characters with ${confidence}% confidence`);
    
    return resultData;
    
  } catch (error) {
    logger.error(`Google Vision API error: ${error.message}`);
    throw error;
  }
}

/**
 * Enhanced Tesseract.js extraction (Fallback method)
 * @param {string} imageUrl - URL of the image
 * @param {string} languages - Language codes
 * @returns {Promise<Object|null>} Extracted text with metadata
 */
async function extractTextWithTesseract(imageUrl, languages = 'eng') {
  let tempFilePath = null;
  
  try {
    logger.debug(`Using Tesseract fallback for: ${imageUrl.substring(0, 50)}...`);
    
    // Check cache
    const cacheKey = `ocr_tess_${Buffer.from(imageUrl).toString('base64').substring(0, 50)}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.debug('Using cached Tesseract result');
      return cached;
    }
    
    // Download image
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    
    const imageBuffer = Buffer.from(response.data);
    
    // Advanced preprocessing
    const preprocessed = await sharp(imageBuffer)
      .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.5 })
      .median(3)
      .linear(1.3, -(128 * 1.3) + 128)
      .png({ quality: 100 })
      .toBuffer();
    
    // Save to temp file
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    tempFilePath = path.join(tempDir, `ocr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`);
    fs.writeFileSync(tempFilePath, preprocessed);
    
    // Perform OCR
    const result = await Tesseract.recognize(tempFilePath, languages, {
      logger: () => {},
      tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      preserve_interword_spaces: '1'
    });
    
    const { data } = result;
    const words = (data.words || []).filter(w => w.confidence > 60);
    const avgConfidence = words.length > 0
      ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
      : 0;
    
    let extractedText = data.text
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s.,!?;:'"()-]/g, '')
      .trim();
    
    // Retry with binary threshold if confidence is low
    if (avgConfidence < 70 && avgConfidence > 0) {
      logger.debug('Low confidence, retrying with binary threshold...');
      
      const binary = await sharp(imageBuffer)
        .grayscale()
        .normalize()
        .threshold(128)
        .png()
        .toBuffer();
      
      fs.writeFileSync(tempFilePath, binary);
      
      const retryResult = await Tesseract.recognize(tempFilePath, languages, {
        logger: () => {},
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
        tessedit_pageseg_mode: Tesseract.PSM.AUTO
      });
      
      if (retryResult.data.confidence > avgConfidence) {
        extractedText = retryResult.data.text
          .replace(/\n/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/[^\w\s.,!?;:'"()-]/g, '')
          .trim();
      }
    }
    
    if (!extractedText || extractedText.length < 3) {
      return null;
    }
    
    // Validate text quality
    const validWords = extractedText.split(/\s+/).filter(word => 
      word.length >= 2 && /[a-zA-Z]/.test(word)
    );
    
    if (validWords.length < 2) {
      return null;
    }
    
    const resultData = {
      text: extractedText,
      confidence: avgConfidence,
      wordCount: words.length,
      language: languages.split('+')[0],
      method: 'tesseract',
      detectedAt: new Date()
    };
    
    // Cache result
    await cache.set(cacheKey, resultData, 7 * 24 * 60 * 60 * 1000);
    
    logger.debug(`Tesseract extracted ${extractedText.length} characters with ${avgConfidence.toFixed(1)}% confidence`);
    
    return resultData;
    
  } catch (error) {
    logger.error(`Tesseract error: ${error.message}`);
    return null;
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        logger.debug(`Failed to clean up: ${err.message}`);
      }
    }
  }
}

/**
 * Smart OCR that tries Google Vision first, falls back to Tesseract
 * @param {string} imageUrl - URL of the image
 * @param {string} languages - Language codes for fallback
 * @returns {Promise<Object|null>} Extracted text with metadata
 */
async function extractTextFromImage(imageUrl, languages = 'eng') {
  try {
    // Try Google Vision first (if available)
    if (visionClient) {
      try {
        const result = await extractTextWithGoogleVision(imageUrl);
        if (result && result.text && result.text.length >= 3) {
          logger.info(`✅ Google Vision success: ${result.text.length} chars, ${result.confidence}% confidence`);
          return result;
        }
      } catch (error) {
        logger.warn(`Google Vision failed, falling back to Tesseract: ${error.message}`);
      }
    }
    
    // Fallback to Tesseract
    logger.info('Using Tesseract fallback');
    const result = await extractTextWithTesseract(imageUrl, languages);
    
    if (result && result.text && result.text.length >= 3) {
      logger.info(`✅ Tesseract success: ${result.text.length} chars, ${result.confidence.toFixed(1)}% confidence`);
      return result;
    }
    
    logger.debug('No text extracted from image');
    return null;
    
  } catch (error) {
    logger.error(`OCR extraction failed: ${error.message}`);
    return null;
  }
}

/**
 * Batch process multiple images with rate limiting
 * @param {Array<string>} imageUrls - Array of image URLs
 * @param {string} languages - Language codes
 * @param {number} concurrency - Number of concurrent requests
 * @returns {Promise<Array>} Array of extraction results
 */
async function batchExtractText(imageUrls, languages = 'eng', concurrency = 3) {
  const results = [];
  
  // Process in batches to respect API rate limits
  for (let i = 0; i < imageUrls.length; i += concurrency) {
    const batch = imageUrls.slice(i, i + concurrency);
    
    const batchResults = await Promise.all(
      batch.map(url => extractTextFromImage(url, languages).catch(err => {
        logger.error(`Batch processing error for ${url}: ${err.message}`);
        return null;
      }))
    );
    
    results.push(...batchResults);
    
    // Small delay between batches to avoid rate limits
    if (i + concurrency < imageUrls.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return results.filter(r => r !== null);
}

module.exports = {
  extractTextFromImage,
  batchExtractText,
  extractTextWithGoogleVision,
  extractTextWithTesseract
};