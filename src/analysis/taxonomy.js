'use strict';
// Project-authored interest taxonomy (method version 2.0.0).
// Keywords are matched as whole tokens after light English suffix stripping, so
// "running" matches "run" but "brunch" never matches "run". The lists are English
// only; posts in other languages fall outside topic coverage and are reported as such.
// prettier-ignore
const TOPICS = {
  technology: [
    'technology', 'tech', 'computer', 'laptop', 'software', 'code', 'coding', 'programming',
    'program', 'python', 'javascript', 'app', 'robot', 'ai', 'gadget', 'phone', 'iphone',
    'android', 'internet', 'website', 'developer', 'engineer', 'data', 'startup',
  ],
  education: [
    'education', 'school', 'university', 'uni', 'college', 'study', 'exam', 'lecture',
    'teacher', 'student', 'class', 'course', 'dissertation', 'thesis', 'degree', 'graduate',
    'graduation', 'homework', 'learn', 'learning', 'revision', 'assignment',
  ],
  work_career: [
    'job', 'work', 'career', 'office', 'boss', 'colleague', 'interview', 'promotion',
    'meeting', 'shift', 'salary', 'hired', 'internship', 'client', 'deadline',
  ],
  travel: [
    'travel', 'trip', 'holiday', 'vacation', 'flight', 'airport', 'hotel', 'abroad',
    'passport', 'journey', 'train', 'tour', 'visit', 'beach', 'roadtrip', 'backpack',
  ],
  food_drink: [
    'food', 'cook', 'cooking', 'recipe', 'restaurant', 'dinner', 'lunch', 'breakfast',
    'brunch', 'cafe', 'coffee', 'pizza', 'lasagna', 'curry', 'bake', 'cake', 'meal', 'eat',
    'delicious', 'tea', 'wine', 'beer',
  ],
  sports_fitness: [
    'sport', 'sports', 'football', 'rugby', 'cricket', 'tennis', 'basketball', 'match',
    'goal', 'league', 'team', 'gym', 'workout', 'run', 'running', 'marathon', 'cycling',
    'swim', 'yoga', 'fitness', 'lift', 'pilates',
  ],
  music: [
    'music', 'song', 'album', 'concert', 'gig', 'band', 'singer', 'playlist', 'guitar',
    'piano', 'festival', 'spotify', 'lyrics',
  ],
  film_tv: [
    'film', 'movie', 'cinema', 'series', 'episode', 'netflix', 'tv', 'show', 'documentary',
    'watch', 'watched', 'trailer',
  ],
  arts_culture: [
    'art', 'painting', 'gallery', 'museum', 'exhibition', 'theatre', 'theater', 'poetry',
    'novel', 'reading', 'photography', 'drawing', 'design', 'bookshop', 'author',
  ],
  family_relationships: [
    'family', 'mum', 'mom', 'dad', 'mother', 'father', 'sister', 'brother', 'son',
    'daughter', 'wife', 'husband', 'partner', 'boyfriend', 'girlfriend', 'wedding',
    'anniversary', 'baby', 'kid', 'grandma', 'grandad', 'birthday',
  ],
  health_wellbeing: [
    'health', 'doctor', 'hospital', 'sick', 'ill', 'tired', 'sleep', 'stress', 'anxiety',
    'therapy', 'meditation', 'diet', 'vegan', 'wellbeing', 'injury', 'recovery',
  ],
  news_politics: [
    'news', 'election', 'vote', 'government', 'politics', 'policy', 'minister', 'protest',
    'parliament', 'council', 'campaign',
  ],
  gaming: ['game', 'gaming', 'playstation', 'xbox', 'nintendo', 'steam', 'gamer', 'esports'],
  nature_outdoors: [
    'nature', 'hike', 'hiking', 'walk', 'mountain', 'park', 'garden', 'forest', 'sea',
    'sunset', 'camping', 'outdoors', 'lake',
  ],
  pets_animals: ['dog', 'cat', 'puppy', 'kitten', 'pet', 'vet', 'horse', 'animal'],
};

// Facebook page categories are a platform-defined vocabulary, so likes are mapped by
// category first. Each entry is matched against whole tokens of the category string.
// prettier-ignore
const PAGE_CATEGORIES = {
  technology: ['software', 'computer', 'technology', 'internet', 'electronics', 'app'],
  education: ['education', 'school', 'university', 'college', 'tutor', 'library'],
  work_career: ['employment', 'recruiter', 'business', 'consulting'],
  travel: ['travel', 'airline', 'hotel', 'tour', 'tourist', 'agency'],
  food_drink: ['restaurant', 'food', 'cafe', 'bakery', 'bar', 'brewery', 'grocery', 'drink'],
  sports_fitness: ['sports', 'athlete', 'team', 'league', 'gym', 'fitness', 'stadium'],
  music: ['musician', 'band', 'music', 'radio', 'concert', 'record'],
  film_tv: ['movie', 'film', 'tv', 'television', 'actor', 'cinema', 'network', 'show'],
  arts_culture: ['artist', 'art', 'museum', 'gallery', 'theatre', 'book', 'author', 'writer'],
  family_relationships: ['parenting', 'family', 'wedding'],
  health_wellbeing: ['health', 'medical', 'hospital', 'wellness', 'doctor'],
  news_politics: ['news', 'media', 'newspaper', 'magazine', 'politician', 'political', 'government'],
  gaming: ['game', 'games', 'gaming', 'esports'],
  nature_outdoors: ['outdoor', 'park', 'nature', 'garden'],
  pets_animals: ['pet', 'animal', 'veterinarian'],
};

// Light, deterministic English suffix stripping. Not a full stemmer: it only merges
// common inflections so word lists stay readable and auditable.
function stem(token) {
  if (token.length <= 4) return token;
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ing') && token.length > 6) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 5) return token.slice(0, -2);
  if (token.endsWith('es') && /(?:ch|sh|x|ss)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

const index = (table) => {
  const map = new Map();
  for (const [topic, words] of Object.entries(table)) {
    for (const word of words) {
      for (const key of new Set([word, stem(word)])) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(topic);
      }
    }
  }
  return map;
};
const TOPIC_INDEX = index(TOPICS);
const CATEGORY_INDEX = index(PAGE_CATEGORIES);

function matchTopics(tokens, table = TOPIC_INDEX) {
  const found = new Set();
  for (const token of tokens) {
    for (const key of new Set([token, stem(token)])) {
      for (const topic of table.get(key) || []) found.add(topic);
    }
  }
  return [...found];
}

module.exports = { TOPICS, PAGE_CATEGORIES, TOPIC_INDEX, CATEGORY_INDEX, stem, matchTopics };
