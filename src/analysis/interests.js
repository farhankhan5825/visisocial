'use strict';
const { finding } = require('../report/feature');
const { tokenize } = require('./text');
const { TOPICS, CATEGORY_INDEX, matchTopics } = require('./taxonomy');

// A like is mapped by its Facebook page category first (a platform-defined vocabulary).
// The page name is used only when the category gives no match. Unmapped likes are
// reported, so the user can see what the taxonomy could not place.
function classifyLike(like) {
  const byCategory = matchTopics(tokenize(like.category || ''), CATEGORY_INDEX);
  if (byCategory.length) return { topics: byCategory, via: 'page_category' };
  const byName = matchTopics(tokenize(like.name));
  return { topics: byName, via: byName.length ? 'page_name' : 'unmapped' };
}

function analyzeInterests(profile) {
  const likes = profile.likes.data;
  const byTopic = new Map();
  const unmapped = [];
  for (const like of likes) {
    const { topics, via } = classifyLike(like);
    if (!topics.length) unmapped.push(like.id);
    for (const topic of topics) {
      if (!byTopic.has(topic)) byTopic.set(topic, { topic, likeIds: [], via: new Set() });
      byTopic.get(topic).likeIds.push(like.id);
      byTopic.get(topic).via.add(via);
    }
  }
  const categories = [...byTopic.values()]
    .map((t) => ({ topic: t.topic, likeIds: t.likeIds, via: [...t.via].sort() }))
    .sort((a, b) => b.likeIds.length - a.likeIds.length || a.topic.localeCompare(b.topic));
  return {
    status: 'ok',
    features: {
      categories: finding(
        categories.length ? categories : null,
        'like_page_category_then_name_taxonomy',
        likes.map((l) => l.id),
        [
          `${Object.keys(TOPICS).length} project categories. A page like is an observed action, not proof of identity, belief or endorsement.`,
          `${unmapped.length} of ${likes.length} likes matched no category.`,
        ],
        { methodVersion: '2.0.0' }
      ),
    },
    diagnostics: { likes: likes.length, unmapped: unmapped.length, unmappedIds: unmapped },
  };
}

module.exports = { analyzeInterests, classifyLike };
