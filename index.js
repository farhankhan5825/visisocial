'use strict';
// The app runs on real data only: it loads .env and starts in live mode. There is no
// user-facing demo. The synthetic fixtures under eval/ are used only by the automated
// tests and the evaluation harness, which start the server with APP_MODE=offline-test.
require('dotenv').config();
const { start } = require('./src/server');
if (require.main === module)
  start().catch((err) => {
    const code = /^[a-z][a-z0-9_]{2,60}$/.test(err?.message || '') ? err.message : 'startup_failed';
    require('./src/privacy/logger').log('startup_failed');
    process.stderr.write(
      `VisiSocial could not start: ${code}\nCheck .env against .env.example (see README, "Run with your Facebook account").\n`
    );
    process.exitCode = 1;
  });
module.exports = { start };
