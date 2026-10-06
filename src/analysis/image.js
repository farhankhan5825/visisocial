'use strict';
const { finding } = require('../report/feature');
const FEATURES = ['LABEL_DETECTION', 'OBJECT_LOCALIZATION', 'LOGO_DETECTION', 'LANDMARK_DETECTION', 'DOCUMENT_TEXT_DETECTION'];
function normalizeVision(response) {
  if (response.error) throw new Error('vision_annotation_failed');
  const scores = key => (response[key] || []).map(a => ({ label: a.description || a.name, confidence: typeof a.score === 'number' ? a.score : null }));
  return { text: response.fullTextAnnotation?.text || response.textAnnotations?.[0]?.description || '', ocrConfidence: null, labels: scores('labelAnnotations'), objects: scores('localizedObjectAnnotations'), logos: scores('logoAnnotations'), landmarks: scores('landmarkAnnotations') };
}
async function analyzeImages(profile, consent, { annotate, fallback } = {}) {
  const photos = profile.photos.data, ids = photos.map(p => p.id);
  if (!photos.length) return { status: 'ok', features: { observations: finding(null, 'vision_five_features', [], ['No photographs were available.']) }, diagnostics: { failures: 0 } };
  if (!consent.vision && !consent.localOcr) return { status: 'unavailable', features: {}, diagnostics: { reason: 'image_consent_not_given' } };
  const results = []; let failures = 0;
  // Bound photo workload and avoid memory spikes from concurrent downloads.
  for (const photo of photos.slice(0, 25)) {
    try {
      if (!consent.vision || !annotate) throw new Error('vision_unavailable');
      results.push({ photoId: photo.id, method: 'google_vision', ...normalizeVision(await annotate(photo, FEATURES)) });
    } catch {
      if (consent.localOcr && fallback) { try { const r = await fallback(photo); results.push({ photoId: photo.id, method: 'tesseract_local', text: r.text, ocrConfidence: typeof r.confidence === 'number' ? r.confidence / 100 : null, labels: [], objects: [], logos: [], landmarks: [] }); } catch { failures++; } }
      else failures++;
    }
  }
  return { status: results.length ? 'ok' : 'failed', features: { observations: finding(results.length ? results : null, 'vision_features_with_optional_local_tesseract_fallback', results.map(p => p.photoId), ['No face recognition, facial attributes or demographic classification. OCR confidence is null unless supplied by local OCR; provider label scores are not accuracy estimates.', 'At most 25 photos per run. Failed photographs and omitted photographs are listed in diagnostics.']) }, diagnostics: { failures, attempted: Math.min(photos.length, 25), omitted: Math.max(0, ids.length - 25) } };
}
module.exports = { analyzeImages, normalizeVision, FEATURES };
