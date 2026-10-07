'use strict';
const { moduleOutput } = require('../schemas');
function synthesize(modules, metadata) {
  const checked = Object.fromEntries(
    Object.entries(modules).map(([key, value]) => [key, moduleOutput.parse(value)])
  );
  const features = Object.fromEntries(
    Object.entries(checked).flatMap(([section, output]) =>
      Object.entries(output.features).map(([key, value]) => [`${section}.${key}`, value])
    )
  );
  return {
    schemaVersion: '3.0.0',
    metadata,
    modules: checked,
    features,
    checklist: Object.entries(features)
      .filter(([, f]) => f.status === 'ok')
      .map(([featureKey, f]) => ({
        featureKey,
        value: f.value,
        inputs: f.inputs,
        method: f.method,
      })),
  };
}
module.exports = { synthesize };
