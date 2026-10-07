'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function files(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? files(path.join(directory, e.name))
        : e.name.endsWith('.js')
          ? [path.join(directory, e.name)]
          : []
    );
}
for (const file of [
  'index.js',
  'jest.config.js',
  ...['src', 'eval', 'tests', 'scripts']
    .flatMap(files)
    .filter((f) => !f.includes(`${path.sep}results${path.sep}`)),
])
  execFileSync(process.execPath, ['--check', file]);
process.stdout.write('JavaScript syntax checks passed.\n');
