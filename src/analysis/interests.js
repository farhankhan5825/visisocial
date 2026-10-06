'use strict';
const { finding } = require('../report/feature');
const { tokenize, TAXONOMY } = require('./text');
function analyzeInterests(profile) {
  const likes = profile.likes.data;
  const matches = Object.entries(TAXONOMY).flatMap(([topic, words]) => { const ids = likes.filter(l => tokenize(`${l.name} ${l.category || ''}`).some(t => words.includes(t))).map(l => l.id); return ids.length ? [{ topic, likeIds: ids }] : []; });
  return { status: 'ok', features: { categories: finding(likes.length ? matches : null, 'like_name_category_fixed_taxonomy', likes.map(l => l.id), ['Six project categories; a page like is an observed action, not proof of identity, belief or endorsement.']) }, diagnostics: {} };
}
module.exports = { analyzeInterests };
