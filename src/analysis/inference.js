'use strict';
const { inferenceItem } = require('../schemas');
const { finding } = require('../report/feature');
const BASIC = ['location', 'occupation', 'interests'];
const SENSITIVE = ['age_range', 'relationship_status'];
function verifyInferences(items, posts, sensitive = false) {
  if (!Array.isArray(items)) throw new Error('invalid_inference_response');
  const accepted = [], rejected = []; const allowed = sensitive ? [...BASIC, ...SENSITIVE] : BASIC;
  for (const [index, raw] of items.entries()) {
    const parsed = inferenceItem.safeParse(raw);
    if (!parsed.success) { rejected.push({ index, reason: 'schema' }); continue; }
    const item = parsed.data;
    if (!allowed.includes(item.attribute)) { rejected.push({ index, reason: 'attribute_not_enabled' }); continue; }
    if (item.guess === null) continue; // Explicit model abstention is not a rejected guess.
    if (!item.evidence.length || item.evidence.some(e => !posts.some(p => p.id === e.postId && (p.message || p.story || '').includes(e.quote)))) { rejected.push({ index, reason: 'missing_or_nonverbatim_evidence' }); continue; }
    if (accepted.some(i => i.attribute === item.attribute)) { rejected.push({ index, reason: 'duplicate_attribute' }); continue; }
    accepted.push(item);
  }
  return { accepted, rejected, attempted: items.length, rejectionRate: items.length ? rejected.length / items.length : null };
}
async function analyzeInference(profile, consent, generate) {
  if (!consent.openai || !generate) return { status: 'unavailable', features: {}, diagnostics: { reason: 'openai_not_enabled' } };
  const posts = profile.posts.data.filter(p => p.message || p.story);
  if (!posts.length) return { status: 'ok', features: { guesses: finding(null, 'llm_exact_quote_verifier', [], ['No text evidence.']) }, diagnostics: { attempted: 0, rejected: 0, rejectionRate: null } };
  const response = await generate('inference', { attributes: consent.sensitive ? [...BASIC, ...SENSITIVE] : BASIC, posts: posts.map(p => ({ id: p.id, text: p.message || p.story })) });
  const v = verifyInferences(response.items, posts, Boolean(consent.sensitive));
  return { status: 'ok', features: { guesses: finding(v.accepted.length ? v.accepted : null, 'llm_guess_with_exact_span_verification', v.accepted.flatMap(i => i.evidence.map(e => e.postId)), ['An AI model guessed these attributes. Verbatim citation checking does not establish that the guess follows from the quote or is true. Certainty is the model’s label, not calibrated confidence.']) }, diagnostics: { attempted: v.attempted, rejected: v.rejected.length, rejectionRate: v.rejectionRate } };
}
module.exports = { analyzeInference, verifyInferences, BASIC, SENSITIVE };
