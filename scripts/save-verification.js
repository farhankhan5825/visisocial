'use strict';
// Copy machine results, avoiding absolute paths and private workspace contents.
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(base, p), 'utf8'));
const run = fs.readFileSync(path.join(base, 'eval/results/LATEST'), 'utf8').trim();
const output = path.join(base, 'eval/results', run);
const summarizeTests = (r) => ({
  success: r.success,
  tests: r.numTotalTests,
  passed: r.numPassedTests,
  failed: r.numFailedTests,
  suites: r.numTotalTestSuites,
  passedSuites: r.numPassedTestSuites,
  startTimeUTC: new Date(r.startTime).toISOString(),
  assertions: r.testResults.flatMap((s) =>
    s.assertionResults.map((a) => ({ title: a.fullName, status: a.status }))
  ),
});
const rootTests = summarizeTests(read('.runtime/final-tests.json'));
const cleanTests = summarizeTests(read('.runtime/clean-check/final-tests.json'));
const semgrep = read('.runtime/semgrep.json'),
  njsscan = read('.runtime/njsscan.json');
const disposition = {
  'express-cookie-session-no-domain':
    'Intentional host-only cookie: no Domain attribute broadening scope. Domain ownership is a deployment boundary.',
  'express-cookie-session-no-expires':
    'maxAge=3600000 calculates Expires; the library recommends maxAge instead of explicitly setting expires.',
  'express-cookie-session-no-path':
    'express-session defaults cookie.path to /, matching all app routes.',
  'express-cookie-session-no-secure':
    'cookie.secure is options.production; live startup forces production and HTTPS origin. Offline demo uses HTTP on loopback. Proxy/TLS deployment remains untested.',
};
fs.writeFileSync(path.join(output, 'tests.json'), JSON.stringify(rootTests, null, 2));
fs.writeFileSync(
  path.join(output, 'clean-install.json'),
  JSON.stringify(
    {
      scope:
        'Source copy in a project-local clean directory; npm ci used the lockfile. Not a remote Git clone.',
      excluded: [
        '.env',
        'private datasets',
        'old logs',
        'uploads',
        'eng.traineddata',
        'local paper',
      ],
      tests: cleanTests,
      offlineEvaluation: read(
        '.runtime/clean-check/eval/results/' +
          fs
            .readFileSync(path.join(base, '.runtime/clean-check/eval/results/LATEST'), 'utf8')
            .trim() +
          '/summary.json'
      ),
      limitations: ['Local Windows/Node environment only; hosted CI has not run.'],
    },
    null,
    2
  )
);
const coverage = read('coverage/coverage-summary.json');
const relativeCoverage = Object.fromEntries(
  Object.entries(coverage).map(([p, v]) => [
    p === 'total' ? p : path.relative(base, p).replaceAll(path.sep, '/'),
    v,
  ])
);
fs.writeFileSync(path.join(output, 'coverage.json'), JSON.stringify(relativeCoverage, null, 2));
fs.copyFileSync(
  path.join(base, '.runtime/dependency-audit-final.json'),
  path.join(output, 'dependency-audit.json')
);
fs.writeFileSync(
  path.join(output, 'security-scans.json'),
  JSON.stringify(
    {
      dateUTC: new Date().toISOString(),
      scope: ['src', 'index.js'],
      privateFilesIncluded: false,
      semgrep: {
        version: semgrep.version,
        config: 'p/nodejs',
        metrics: 'off',
        findings: semgrep.results.map((r) => ({
          rule: r.check_id,
          path: r.path.replaceAll('\\', '/'),
          line: r.start.line,
          message: r.extra.message,
          severity: r.extra.severity,
          disposition: disposition[r.check_id.split('.').at(-1)] || 'requires_review',
        })),
        errors: semgrep.errors,
        scannedPaths: semgrep.paths.scanned,
      },
      njsscan: {
        ...njsscan,
        limitation:
          'Executed on Windows, although the documented supported platforms are Linux/macOS. No claim of complete semantic coverage; supported-platform CI is configured but has not run.',
      },
      cookieReference: 'https://expressjs.com/en/resources/middleware/session/',
      assurance:
        'Pattern scanning and dependency advisories are not a penetration test or proof of security.',
    },
    null,
    2
  )
);
process.stdout.write(
  JSON.stringify({
    tests: rootTests.passed,
    cleanTests: cleanTests.passed,
    coverage: relativeCoverage.total,
    semgrepFindings: semgrep.results.length,
    dependencyAdvisories: read('.runtime/dependency-audit-final.json').metadata.vulnerabilities
      .total,
  }) + '\n'
);
