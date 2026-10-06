'use strict';
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const inference = object({ items: { type: 'array', items: object({ attribute: { type: 'string', enum: ['location', 'occupation', 'interests', 'age_range', 'relationship_status'] }, guess: { type: ['string', 'null'] }, evidence: { type: 'array', items: object({ postId: string, quote: string }) }, certainty: { type: 'string', enum: ['low', 'medium', 'high'] } }) } });
const explanation = object({ sentences: { type: 'array', items: object({ text: string, supportedBy: { type: 'array', items: string } }) } });
const judge = object({ supported: { type: 'boolean' } });
function providerSchema(template) { return { type: 'json_schema', json_schema: { name: template.replaceAll('-', '_'), strict: true, schema: template === 'inference' ? inference : template === 'judge' ? judge : explanation } }; }
module.exports = { providerSchema };
