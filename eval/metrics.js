'use strict';
function precisionRecall(predicted, truth) {
  const p = new Set(predicted), t = new Set(truth), tp = [...p].filter(x => t.has(x)).length;
  return { tp, fp: p.size - tp, fn: t.size - tp, precision: p.size ? tp / p.size : null, recall: t.size ? tp / t.size : null };
}
function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const current = [i]; for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = current; }
  return previous[b.length];
}
function ocrError(predicted, truth) {
  const chars = Array.from(truth), words = truth.trim() ? truth.trim().split(/\s+/) : [], predictedWords = predicted.trim() ? predicted.trim().split(/\s+/) : [];
  const characterEdits = editDistance(Array.from(predicted), chars), wordEdits = editDistance(predictedWords, words);
  return { characterEdits, characters: chars.length, wordEdits, words: words.length, CER: chars.length ? characterEdits / chars.length : null, WER: words.length ? wordEdits / words.length : null };
}
function distribution(values) {
  if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b);
  const quantile = p => { const index = (sorted.length - 1) * p, lower = Math.floor(index); return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower); };
  return { n: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, median: quantile(.5), p95: quantile(.95), min: sorted[0], max: sorted.at(-1), unit: 'milliseconds', quantileMethod: 'linear interpolation over sorted samples' };
}
module.exports = { precisionRecall, editDistance, ocrError, distribution };
