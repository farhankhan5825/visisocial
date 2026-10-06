'use strict';
const { feature } = require('../schemas');
function finding(value, method, inputs = [], limitations = [], options = {}) {
  return feature.parse({ value, status: value === null ? 'insufficient_evidence' : 'ok', method, methodVersion: '1.0.0', inputs: [...new Set(inputs)], n: new Set(inputs).size, confidence: null, limitations, ...options });
}
module.exports = { finding };
