const http = require('http');
const { loadConfig } = require('./src/config');
const { createSdk } = require('./src/sdk');
const { startPeerWorker } = require('./src/peerWorker');
const { handleRunRequest } = require('./src/runFlow');

const config = loadConfig();
const { sdk, mode } = createSdk(config);

startPeerWorker({ sdk, config });

const server = http.createServer(async (req, res) => {
  if (req.url !== '/' || req.method !== 'GET') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  if (!checkAuth(req, res, config)) return;

  await handleRunRequest(req, res, { sdk, config });
});

server.listen(config.port, config.listenHost, () => {
  console.log(
    `[services-monitor] listening on ${config.listenHost}:${config.port} as ${config.hostAddr} (${mode} mode) with peers: ${
      config.peers.join(', ') || 'none'
    }`
  );
});

function checkAuth(req, res, config) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Basic (.+)$/);
  if (!match) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Services Monitor"' });
    res.end('Authentication required');
    return false;
  }
  const creds = Buffer.from(match[1], 'base64').toString();
  const [user, pass] = creds.split(':');
  if (user === config.adminUser && pass === config.adminPass) {
    return true;
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Services Monitor"' });
  res.end('Invalid credentials');
  return false;
}
