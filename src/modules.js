'use strict';
const { analyzeText } = require('./analysis/text');
const { analyzeTemporal } = require('./analysis/temporal');
const { analyzeInterests } = require('./analysis/interests');
const { analyzeImages } = require('./analysis/image');
const { analyzeInference } = require('./analysis/inference');
const { analyzeExposure } = require('./analysis/osint');
const { explain } = require('./report/explain');
function createModules(providers, identity) {
  const guard = (edge, fn) => (p, c) =>
    p.acquisitionErrors.includes(edge)
      ? {
          status: 'unavailable',
          features: {},
          diagnostics: {
            reason: `${edge}_acquisition_failed`,
            code: p.acquisitionCodes?.[edge] || 'unknown',
          },
        }
      : fn(p, c);
  return {
    modules: {
      text: guard('posts', analyzeText),
      temporal: guard('posts', (p) => analyzeTemporal(p)),
      interests: guard('likes', analyzeInterests),
      image: guard('photos', (p, c) => analyzeImages(p, c, providers)),
      inference: guard('posts', (p, c) => analyzeInference(p, c, providers.generate)),
      osint: (p, c) =>
        analyzeExposure(p, c, {
          verifiedEmail: identity.email,
          checkBreaches: providers.checkBreaches,
        }),
    },
    explain: (features, consent) => explain(features, consent, providers.generate),
  };
}
module.exports = { createModules };
