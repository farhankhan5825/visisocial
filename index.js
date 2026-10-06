'use strict';
// The legacy runtime is disabled while the evidence-grounded replacement is built.
const http = require('node:http');
const server = http.createServer((_req, res) => {
  res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('VisiSocial is being rebuilt. No analysis or external searches are available.\n');
});
if (require.main === module) server.listen(Number(process.env.PORT) || 3001, '127.0.0.1');
module.exports = server;
