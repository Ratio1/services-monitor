const http = require('http');
const { loadConfig } = require('./src/config');
const { createSdk } = require('./src/sdk');
const { startPeerWorker } = require('./src/peerWorker');
const { handleRunRequest } = require('./src/runFlow');

const config = loadConfig();
const { sdk, mode } = createSdk(config);

startPeerWorker({ sdk, config });

const MAX_ACTIVE_RUNS = 4;
let activeRuns = 0;

const server = http.createServer(async (req, res) => {
  if (req.url !== '/' || req.method !== 'GET') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  if (!checkAuth(req, res, config)) return;

  if (activeRuns >= MAX_ACTIVE_RUNS) {
    console.warn(
      `[services-monitor] reject run due to slot limit (${MAX_ACTIVE_RUNS}) on ${config.hostAddr}`
    );
    res.writeHead(429, { 'Content-Type': 'text/plain' });
    res.end('Too many concurrent runs on this node (max 4). Please retry shortly.');
    return;
  }

  console.log(
    `[services-monitor] accepting run; active slots ${activeRuns + 1}/${MAX_ACTIVE_RUNS} on ${config.hostAddr}`
  );
  activeRuns += 1;
  try {
    await handleRunRequest(req, res, { sdk, config });
  } finally {
    activeRuns = Math.max(0, activeRuns - 1);
    console.log(
      `[services-monitor] run ended; active slots ${activeRuns}/${MAX_ACTIVE_RUNS} on ${config.hostAddr}`
    );
  }
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
