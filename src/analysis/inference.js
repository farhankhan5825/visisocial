'use strict';
const { inferenceItem } = require('../schemas');
const { finding } = require('../report/feature');
const BASIC = ['location', 'occupation', 'interests'];
const SENSITIVE = ['age_range', 'relationship_status'];
const TRAITS = ['openness', 'conscientiousness', 'extraversion', 'agreeableness'];
const MAX_POSTS = 200;
function meaningfulGuess(value, attribute) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const text = value
    .trim()
    .replace(/^["']+|["'.]+$/g, '')
    .toLowerCase();
  if (
    /^(value(?: or null)?|string|null|undefined|unknown|n\/?a|not available|guess|exact span|one of the enabled attributes)$/.test(
      text
    )
  )
    return false;
  if (TRAITS.includes(attribute) && (/\d/.test(text) || /^(low|medium|high)$/.test(text)))
    return false;
  return true;
}
// Quotes must contain the same words in the same order as the cited post. Only typography
// is forgiven: Unicode form, curly versus straight quotes and apostrophes, dash variants,
// letter case and runs of whitespace. A quote shorter than four characters proves nothing.
function normalize(text = '') {
  return text
    .normalize('NFKC')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
function evidenceProblem(e, posts) {
  const post = posts.find((p) => p.id === e.postId);
  if (!post) return 'unknown_post';
  const quote = normalize(e.quote).replace(/^["']+|["']+$/g, '');
  if (quote.length < 4) return 'quote_too_short';
  return normalize(post.message || post.story || '').includes(quote) ? null : 'quote_not_in_post';
}
function verifyInferences(items, posts, sensitive = false, personality = false) {
  if (!Array.isArray(items)) throw new Error('invalid_inference_response');
  const accepted = [],
    rejected = [];
  const allowed = [...BASIC, ...(sensitive ? SENSITIVE : []), ...(personality ? TRAITS : [])];
  for (const [index, raw] of items.entries()) {
    const parsed = inferenceItem.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ index, reason: 'schema' });
      continue;
    }
    const item = parsed.data;
    if (!allowed.includes(item.attribute)) {
      rejected.push({ index, reason: 'attribute_not_enabled' });
      continue;
    }
    if (item.guess === null) continue; // Explicit model abstention is not a rejected guess.
    if (!meaningfulGuess(item.guess, item.attribute)) {
      rejected.push({ index, reason: 'placeholder_or_invalid_description' });
      continue;
    }
    const problem = !item.evidence.length
      ? 'no_evidence'
      : item.evidence.map((e) => evidenceProblem(e, posts)).find(Boolean);
    if (problem) {
      rejected.push({ index, reason: problem });
      continue;
    }
    if (accepted.some((i) => i.attribute === item.attribute)) {
      rejected.push({ index, reason: 'duplicate_attribute' });
      continue;
    }
    accepted.push(item);
  }
  return {
    accepted,
    rejected,
    attempted: items.length,
    rejectionRate: items.length ? rejected.length / items.length : null,
  };
}
async function analyzeInference(profile, consent, generate) {
  if (!consent.openai || !generate) {
    const reason = !consent.openai ? 'openai_not_consented' : 'openai_not_configured';
    return { status: 'unavailable', features: {}, diagnostics: { reason } };
  }
  // The 200 most recent text posts: bounded cost, and within the schema's ID enum limit.
  const posts = profile.posts.data.filter((p) => p.message || p.story).slice(0, MAX_POSTS);
  if (!posts.length)
    return {
      status: 'ok',
      features: { guesses: finding(null, 'llm_exact_quote_verifier', [], ['No text evidence.']) },
      diagnostics: {
        attempted: 0,
        rejected: 0,
        rejectionRate: null,
        ...(consent.personality ? { personalityEnabled: true } : {}),
      },
    };
  const response = await generate('inference', {
    attributes: [
      ...BASIC,
      ...(consent.sensitive ? SENSITIVE : []),
      ...(consent.personality ? TRAITS : []),
    ],
    posts: posts.map((p) => ({ id: p.id, text: p.message || p.story })),
  });
  const v = verifyInferences(
    response.items,
    posts,
    Boolean(consent.sensitive),
    Boolean(consent.personality)
  );
  return {
    status: 'ok',
    features: {
      guesses: finding(
        v.accepted.length ? v.accepted : null,
        'llm_guess_with_exact_span_verification',
        v.accepted.flatMap((i) => i.evidence.map((e) => e.postId)),
        [
          'An AI model guessed these attributes. Verbatim citation checking does not establish that the guess follows from the quote or is true. Certainty is the model’s label, not calibrated confidence.',
        ]
      ),
    },
    diagnostics: {
      ...(consent.personality ? { personalityEnabled: true } : {}),
      attempted: v.attempted,
      rejected: v.rejected.length,
      rejectionRate: v.rejectionRate,
      rejectionReasons: v.rejected.reduce(
        (n, r) => ({ ...n, [r.reason]: (n[r.reason] || 0) + 1 }),
        {}
      ),
      postsSent: posts.length,
    },
  };
}
module.exports = {
  analyzeInference,
  verifyInferences,
  normalize,
  meaningfulGuess,
  BASIC,
  SENSITIVE,
  TRAITS,
};
