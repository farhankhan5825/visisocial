const { consoleView, sentimentHistory } = require('../src/report/console');
const golden = require('./golden/p01.report.json');
const ejs = require('ejs');
const path = require('node:path');

test('timeline uses dated scored posts only and keeps their real values', () => {
  const report = structuredClone(golden);
  report.sources.posts = {
    a: { time: '2026-10-01T12:00:00Z' },
    b: { time: '2026-10-02T12:00:00Z' },
    c: { time: null },
  };
  report.features['text.sentiment'].value.posts = [
    { postId: 'b', score: 1, label: 'positive' },
    { postId: 'a', score: -1, label: 'negative' },
    { postId: 'c', score: 0.5, label: 'positive' },
    { postId: 'a', score: null, label: 'unscored' },
  ];
  const chart = sentimentHistory(report);
  expect(chart.points.map((p) => p.id)).toEqual(['a', 'b']);
  expect(chart.points.map((p) => p.y)).toEqual([170, 30]);
  report.features['text.sentiment'].value.posts = [];
  expect(sentimentHistory(report)).toBeNull();
});

test('dashboard keeps unavailable and zero-breach states distinct and escapes source text', async () => {
  const report = structuredClone(golden);
  report.modules.osint = {
    status: 'unavailable',
    features: {},
    diagnostics: { reason: 'hibp_not_consented' },
  };
  delete report.features['osint.breaches'];
  report.explanations = { status: 'unavailable' };
  const render = (r) =>
    ejs.renderFile(path.join(__dirname, '../src/views/dashboard.ejs'), {
      consoleData: consoleView(r, { name: '<script>alert(1)</script>' }),
      signedIn: true,
      demo: false,
      csrf: 'test',
      v: 'test',
      path: '/dashboard',
    });
  const missing = await render(report);
  expect(missing).toContain('did not consent');
  expect(missing).not.toContain('No records found');
  expect(missing).not.toContain('<script>alert(1)</script>');
  report.modules.osint = structuredClone(golden.modules.osint);
  report.features['osint.breaches'] = { ...golden.features['osint.breaches'], value: [] };
  const clean = await render(report);
  expect(clean).toContain('No records found');
  report.modules.inference.diagnostics.personalityEnabled = true;
  const abstained = await render(report);
  expect(abstained).toContain(
    'Analysis ran; no personality observation had sufficient supporting evidence.'
  );
});

test('legacy placeholders are absent from traits, graph and evidence without shifting feedback indexes', async () => {
  const report = structuredClone(golden);
  const valid = report.features['inference.guesses'].value[0];
  report.features['inference.guesses'].value = [
    { ...valid, attribute: 'openness', guess: 'value' },
    valid,
  ];
  report.explanations = {
    status: 'ok',
    attempted: 1,
    flagged: 0,
    sentences: [
      { text: 'A long metric paragraph with 0.475054054054054.', supportedBy: ['text.sentiment'] },
    ],
  };
  const view = consoleView(report, { name: 'Test' });
  expect(view.counts.guessed).toBe(1);
  expect(view.graph.some((n) => n.value === 'value')).toBe(false);
  expect(view.traits.find((t) => t.name === 'openness')).toMatchObject({
    finding: null,
    invalid: true,
  });
  expect(view.findings.find((f) => f.layer === 'guessed').feedbackIndex).toBe(1);
  expect(view.summary.title).toBe('Profile snapshot');
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/dashboard.ejs'), {
    consoleData: view,
    signedIn: true,
    demo: false,
    csrf: 'test',
    v: 'test',
    path: '/dashboard',
  });
  expect(html).toContain('Re-run needed');
  expect(html).not.toContain('0.475054054054054');
  expect(html).not.toContain('>value');
});

test('existing reports lead with a tentative personal portrait and put statistics underneath', async () => {
  const report = structuredClone(golden);
  delete report.explanations.profile;
  const base = report.features['inference.guesses'].value[0];
  report.features['inference.guesses'].value.push(
    { ...base, attribute: 'occupation', guess: 'software engineering' },
    { ...base, attribute: 'openness', guess: 'curious about new ideas' }
  );
  const view = consoleView(report, { name: 'Test' });
  expect(view.summary.text).toContain(
    'Your posts suggest your work or studies may involve software engineering, with ties to Swansea.'
  );
  expect(view.summary.text).toContain('curious about new ideas');
  expect(view.summary.text).toContain('tentative AI impression');
  expect(view.summary.text).not.toMatch(/sentiment|score|reading ease|peak|mostly positive/);
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/dashboard.ejs'), {
    consoleData: view,
    signedIn: true,
    demo: false,
    csrf: 'test',
    v: 'test',
    path: '/dashboard',
  });
  expect(html.indexOf(view.summary.text)).toBeLessThan(html.indexOf('Technical analysis'));
  expect(html).toContain('Reading ease');
});

test('old analytics summaries are replaced, while a verified personal portrait is preserved', () => {
  const report = structuredClone(golden);
  report.explanations.profile = {
    status: 'ok',
    sentences: [{ text: 'Your posts mention gaming.', supportedBy: ['text.topics'] }],
  };
  expect(consoleView(report, { name: 'Test' }).summary.title).toBe('Profile snapshot');
  report.explanations.profile = {
    status: 'ok',
    format: 'personal_portrait_v1',
    sentences: [
      { text: 'Your posts suggest you have ties to Swansea.', supportedBy: ['inference.guesses'] },
    ],
  };
  expect(consoleView(report, { name: 'Test' }).summary).toEqual({
    title: 'AI profile summary',
    text: 'Your posts suggest you have ties to Swansea.',
  });
});
