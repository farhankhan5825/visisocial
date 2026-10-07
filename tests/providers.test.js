const { liveProviders, MODEL } = require('../src/providers');
const { log } = require('../src/privacy/logger');
test('pinned inference request uses strict native JSON schema and no application storage', async () => {
  const original = global.fetch;
  let body;
  global.fetch = jest.fn(async (url, options) => {
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"items":[]}' } }] }),
    };
  });
  try {
    const p = liveProviders({ OPENAI_API_KEY: 'synthetic-test-key' });
    expect(await p.generate('inference', { posts: [] })).toEqual({ items: [] });
    expect(body.model).toBe(MODEL);
    expect(body.temperature).toBe(0);
    expect(body.store).toBe(false);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[1].content).toBe('{"posts":[]}');
  } finally {
    global.fetch = original;
  }
});
test('HIBP sends attribution-compatible user-agent and requests full breach objects; 404 is empty', async () => {
  const original = global.fetch;
  global.fetch = jest.fn(async (url, options) => {
    expect(url).toContain('self%40example.test?truncateResponse=false');
    expect(options.headers['user-agent']).toContain('VisiSocial/3.0');
    return { status: 404 };
  });
  try {
    expect(
      await liveProviders({ HIBP_API_KEY: 'synthetic' }).checkBreaches('self@example.test')
    ).toEqual([]);
  } finally {
    global.fetch = original;
  }
});
test('logger refuses free text and discards identifiers including numeric IDs', () => {
  const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    log('analysis_complete', {
      user_id: 1234567890123,
      email: 'secret@example.test',
      duration_ms: 25,
    });
    expect(write.mock.calls[0][0]).not.toContain('secret');
    expect(write.mock.calls[0][0]).not.toContain('1234567890123');
    expect(write.mock.calls[0][0]).toContain('duration_ms');
    expect(() => log('user 123')).toThrow();
  } finally {
    write.mockRestore();
  }
});
