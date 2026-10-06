const { analyzeInterests } = require('../src/analysis/interests');
test('likes map to documented categories with supporting ids', () => { const r = analyzeInterests({ likes: { data: [{ id: 'l1', name: 'Software education', category: 'Technology' }, { id: 'l2', name: 'said brunch' }] } }); expect(r.features.categories.value).toEqual([{ topic: 'technology', likeIds: ['l1'] }, { topic: 'education', likeIds: ['l1'] }]); });
test('no likes abstains', () => { expect(analyzeInterests({ likes: { data: [] } }).features.categories.status).toBe('insufficient_evidence'); });
