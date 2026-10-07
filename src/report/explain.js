'use strict';
const { explanationOutput } = require('../schemas');
function numbers(value) {
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') return (value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (Array.isArray(value)) return value.flatMap(numbers);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbers);
  return [];
}
async function verifySentences(raw, features, judge) {
  if (!raw || !Array.isArray(raw.sentences)) throw new Error('invalid_explanation_response');
  const accepted = [],
    rejected = [];
  for (const [index, item] of raw.sentences.entries()) {
    const parsed = explanationOutput.safeParse({ sentences: [item] });
    if (!parsed.success) {
      rejected.push({ index, reason: 'schema' });
      continue;
    }
    if (
      item.supportedBy.some((key) => !Object.hasOwn(features, key) || features[key].status !== 'ok')
    ) {
      rejected.push({ index, reason: 'unknown_or_unavailable_feature' });
      continue;
    }
    const selected = Object.fromEntries(item.supportedBy.map((key) => [key, features[key]]));
    const allowed = Object.values(selected).flatMap((f) => [...numbers(f.value), f.n]);
    if (numbers(item.text).some((number) => !allowed.some((v) => Math.abs(number - v) < 1e-9))) {
      rejected.push({ index, reason: 'numeric_mismatch' });
      continue;
    }
    let supported = false;
    try {
      supported = (await judge({ sentence: item.text, features: selected })).supported === true;
    } catch {
      /* Fail closed if judge fails. */
    }
    if (!supported) {
      rejected.push({ index, reason: 'judge_rejected' });
      continue;
    }
    accepted.push(item);
  }
  return {
    status: 'ok',
    sentences: accepted,
    attempted: raw.sentences.length,
    flagged: rejected.length,
    flaggedRate: raw.sentences.length ? rejected.length / raw.sentences.length : null,
    rejections: rejected,
    verifier:
      'feature_keys + exact_numeric_values + second_llm_judge; not independent human validation',
  };
}
async function explain(features, consent, generate) {
  if (!consent.openai || !generate)
    return { status: 'unavailable', sentences: [], attempted: 0, flagged: 0, flaggedRate: null };
  const sections = [...new Set(Object.keys(features).map((k) => k.split('.')[0]))],
    raw = { sentences: [] };
  const failures = [],
    failureCodes = {};
  for (const section of sections) {
    const values = Object.fromEntries(
      Object.entries(features).filter(
        ([key, f]) => key.startsWith(`${section}.`) && f.status === 'ok'
      )
    );
    if (!Object.keys(values).length) continue;
    try {
      const output = await generate(`explain-${section}`, values);
      if (!Array.isArray(output?.sentences)) throw new Error();
      raw.sentences.push(...output.sentences);
    } catch (err) {
      failures.push(section);
      const code = /^[a-z][a-z0-9_]{2,60}$/.test(err?.message || '')
        ? err.message
        : 'invalid_output';
      failureCodes[section] = code;
    }
  }
  return {
    ...(await verifySentences(raw, features, (input) => generate('judge', input))),
    profile: await explainProfile(features, generate),
    sectionFailures: failures,
    sectionFailureCodes: failureCodes,
  };
}

async function explainProfile(features, generate) {
  const selected = Object.fromEntries(
    ['text.topics', 'interests.categories', 'inference.guesses']
      .filter((key) => features[key]?.status === 'ok')
      .map((key) => [
        key,
        key === 'inference.guesses'
          ? {
              ...features[key],
              value: features[key].value.filter(
                (g) => !['age_range', 'relationship_status'].includes(g.attribute)
              ),
            }
          : features[key],
      ])
  );
  if (!Object.keys(selected).length) return { status: 'unavailable', sentences: [] };
  try {
    const output = await generate('explain-profile', selected);
    const parsed = explanationOutput.parse(output);
    const text = parsed.sentences.map((s) => s.text).join(' ');
    if (parsed.sentences.length > 3 || text.trim().split(/\s+/).length > 65 || /\d/.test(text))
      throw new Error('invalid_profile_summary');
    return {
      ...(await verifySentences(parsed, selected, (input) => generate('judge', input))),
      format: 'personal_portrait_v1',
    };
  } catch (err) {
    return {
      status: 'failed',
      sentences: [],
      error: /^[a-z][a-z0-9_]{2,60}$/.test(err?.message || '')
        ? err.message
        : 'invalid_profile_summary',
    };
  }
}
module.exports = { explain, explainProfile, verifySentences, numbers };
