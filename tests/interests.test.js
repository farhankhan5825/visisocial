const { analyzeInterests, classifyLike } = require('../src/analysis/interests');

test('likes map by page category first, then page name, with supporting ids', () => {
  const r = analyzeInterests({
    likes: {
      data: [
        { id: 'l1', name: 'Coldplay', category: 'Musician/Band' },
        { id: 'l2', name: 'Swansea City AFC', category: 'Sports Team' },
        { id: 'l3', name: 'Python coding club', category: 'Community' },
        { id: 'l4', name: 'said brunchly', category: 'Community' },
      ],
    },
  });
  expect(r.features.categories.value).toEqual([
    { topic: 'music', likeIds: ['l1'], via: ['page_category'] },
    { topic: 'sports_fitness', likeIds: ['l2'], via: ['page_category'] },
    { topic: 'technology', likeIds: ['l3'], via: ['page_name'] },
  ]);
  expect(r.diagnostics).toMatchObject({ likes: 4, unmapped: 1, unmappedIds: ['l4'] });
});

test('a category match takes precedence over the page name', () => {
  expect(classifyLike({ name: 'Netflix film club', category: 'TV Network' })).toEqual({
    topics: ['film_tv'],
    via: 'page_category',
  });
});

test('no likes abstains', () => {
  expect(analyzeInterests({ likes: { data: [] } }).features.categories.status).toBe(
    'insufficient_evidence'
  );
});
