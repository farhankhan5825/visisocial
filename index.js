'use strict';
// Demo is the default and never loads local credentials. Live mode is explicit.
if (process.env.APP_MODE === 'live') require('dotenv').config();
const { start } = require('./src/server');
if (require.main === module) start().catch(() => { require('./src/privacy/logger').log('startup_failed'); process.exitCode = 1; });
module.exports = { start };
