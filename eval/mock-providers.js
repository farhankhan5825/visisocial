'use strict';
const fs = require('node:fs');
const path = require('node:path');
function mockProviders(id) {
  if (!/^p\d{2}$/.test(id)) throw new Error('invalid_fixture_id');
  const responses = JSON.parse(fs.readFileSync(path.join(__dirname, 'profiles', `${id}.mocks.json`), 'utf8'));
  return {
    annotate: async photo => structuredClone(responses.vision[photo.id]),
    checkBreaches: async email => { if (email !== `${id}@example.test`) throw new Error('not_fixture_owner'); return structuredClone(responses.breaches); },
    generate: async (template, payload) => {
      if (template === 'inference') return structuredClone(responses.inference);
      if (template === 'judge') {
        const n = Object.values(payload.features)[0].n;
        return { supported: payload.sentence === `This section uses ${n} source items.` };
      }
      const key = Object.keys(payload)[0], n = payload[key].n;
      return { sentences: [{ text: `This section uses ${n} source items.`, supportedBy: [key] }, { text: 'You shared 999 posts.', supportedBy: [key] }, { text: 'You earn more than other people.', supportedBy: [key] }] };
    }
  };
}
module.exports = { mockProviders };
