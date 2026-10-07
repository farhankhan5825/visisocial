'use strict';
function precisionRecall(predicted, truth) {
  const p = new Set(predicted),
    t = new Set(truth),
    tp = [...p].filter((x) => t.has(x)).length;
  return {
    tp,
    fp: p.size - tp,
    fn: t.size - tp,
    precision: p.size ? tp / p.size : null,
    recall: t.size ? tp / t.size : null,
  };
}
function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    previous = current;
  }
  return previous[b.length];
}
function ocrError(predicted, truth) {
  const chars = Array.from(truth),
    words = truth.trim() ? truth.trim().split(/\s+/) : [],
    predictedWords = predicted.trim() ? predicted.trim().split(/\s+/) : [];
  const characterEdits = editDistance(Array.from(predicted), chars),
    wordEdits = editDistance(predictedWords, words);
  return {
    characterEdits,
    characters: chars.length,
    wordEdits,
    words: words.length,
    CER: chars.length ? characterEdits / chars.length : null,
    WER: words.length ? wordEdits / words.length : null,
  };
}
function distribution(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p) => {
    const index = (sorted.length - 1) * p,
      lower = Math.floor(index);
    return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
  };
  return {
    n: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: quantile(0.5),
    p95: quantile(0.95),
    min: sorted[0],
    max: sorted.at(-1),
    unit: 'milliseconds',
    quantileMethod: 'linear interpolation over sorted samples',
  };
}
// Wilson score interval for a binomial proportion (95% by default). Unlike the normal
// approximation it stays inside [0, 1] and behaves sensibly for small n.
function wilson(successes, n, z = 1.959964) {
  if (!n) return null;
  const p = successes / n,
    denom = 1 + (z * z) / n,
    centre = (p + (z * z) / (2 * n)) / denom,
    half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { estimate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half), n };
}
// Single-label classification over paired rows { truth, predicted }.
function classification(rows, labels) {
  const confusion = Object.fromEntries(
    labels.map((t) => [t, Object.fromEntries(labels.map((p) => [p, 0]))])
  );
  rows.forEach((r) => confusion[r.truth][r.predicted]++);
  const correct = rows.filter((r) => r.truth === r.predicted).length;
  const perLabel = Object.fromEntries(
    labels.map((label) => {
      const tp = confusion[label][label],
        fp = labels.reduce((n, t) => n + (t === label ? 0 : confusion[t][label]), 0),
        fn = labels.reduce((n, p) => n + (p === label ? 0 : confusion[label][p]), 0),
        precision = tp + fp ? tp / (tp + fp) : null,
        recall = tp + fn ? tp / (tp + fn) : null,
        f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
      return [label, { tp, fp, fn, support: tp + fn, precision, recall, f1 }];
    })
  );
  const supported = labels.filter((l) => perLabel[l].support > 0);
  return {
    n: rows.length,
    correct,
    accuracy: wilson(correct, rows.length),
    macroF1: supported.length
      ? supported.reduce((n, l) => n + perLabel[l].f1, 0) / supported.length
      : null,
    perLabel,
    confusion,
    confusionAxes: 'confusion[truth][predicted]',
  };
}
// Micro-averaged precision/recall/F1 over pooled { tp, fp, fn } counts.
function pooled(results) {
  const tp = results.reduce((n, r) => n + r.tp, 0),
    fp = results.reduce((n, r) => n + r.fp, 0),
    fn = results.reduce((n, r) => n + r.fn, 0),
    precision = tp + fp ? tp / (tp + fp) : null,
    recall = tp + fn ? tp / (tp + fn) : null;
  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1:
      precision && recall
        ? (2 * precision * recall) / (precision + recall)
        : precision === null && recall === null
          ? null
          : 0,
    precisionCI: wilson(tp, tp + fp),
    recallCI: wilson(tp, tp + fn),
  };
}
module.exports = {
  precisionRecall,
  editDistance,
  ocrError,
  distribution,
  wilson,
  classification,
  pooled,
};
