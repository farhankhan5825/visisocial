'use strict';
// Strict JSON schemas for every model call. Where the payload defines the only valid
// identifiers (post IDs for guesses, feature keys for explanations), the schema
// enumerates them, so the model cannot cite an ID or key that does not exist.
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: 'string' };
const oneOf = (values) => (values && values.length ? { type: 'string', enum: values } : string);

function inference(payload) {
  const postIds = Array.isArray(payload?.posts) ? payload.posts.map((p) => p.id) : null;
  return object({
    items: {
      type: 'array',
      items: object({
        attribute: {
          type: 'string',
          enum: payload?.attributes || [
            'location',
            'occupation',
            'interests',
            'age_range',
            'relationship_status',
          ],
        },
        guess: {
          type: ['string', 'null'],
          description:
            'An actual supported attribute or a short behavioural description, never a schema placeholder such as value. Use JSON null to abstain.',
        },
        evidence: { type: 'array', items: object({ postId: oneOf(postIds), quote: string }) },
        certainty: { type: 'string', enum: ['low', 'medium', 'high'] },
      }),
    },
  });
}
function explanation(payload) {
  const keys = payload && typeof payload === 'object' ? Object.keys(payload) : null;
  return object({
    sentences: {
      type: 'array',
      items: object({ text: string, supportedBy: { type: 'array', items: oneOf(keys) } }),
    },
  });
}
const judge = object({ supported: { type: 'boolean' } });

function providerSchema(template, payload) {
  return {
    type: 'json_schema',
    json_schema: {
      name: template.replaceAll('-', '_'),
      strict: true,
      schema:
        template === 'inference'
          ? inference(payload)
          : template === 'judge'
            ? judge
            : explanation(payload),
    },
  };
}
module.exports = { providerSchema };
