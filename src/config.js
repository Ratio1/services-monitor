const REQUIRED_ENV = ['EE_CHAINSTORE_API_URL', 'EE_R1FS_API_URL', 'R1EN_HOST_ADDR', 'R1EN_CHAINSTORE_PEERS'];

function loadConfig() {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'r@t100ne-monitor';
  const monitorPepper = process.env.SERVICES_MONITOR_PEPPER || 'services-monitor';
  const hkey = 'services-monitor';
  const port = Number(process.env.PORT || 3000);
  const listenHost = process.env.LISTEN_HOST || '0.0.0.0';

  const missingRequired = REQUIRED_ENV.some((key) => !process.env[key]);
  const forceTest = process.env.SERVICES_MONITOR_TEST === '1';
  const testMode = forceTest || missingRequired;

  const hostAddr = testMode ? 'initiator-local' : process.env.R1EN_HOST_ADDR;
  const peersRaw = testMode ? null : process.env.R1EN_CHAINSTORE_PEERS;
  const peers = parsePeers(peersRaw, hostAddr, testMode);

  return {
    port,
    adminUser,
    adminPass,
    hostAddr,
    listenHost,
    peers,
    hkey,
    pepper: monitorPepper,
    timeouts: {
      ackMs: 15_000,
      downloadMs: 45_000,
      reverseMs: 60_000,
      overallMs: 180_000
    },
    testMode
  };
}

function parsePeers(raw, hostAddr, testMode) {
  if (testMode) {
    return ['peer-a', 'peer-b', 'peer-c'];
  }
  if (!raw) return [];
  try {
    const parsed = Array.isArray(raw) ? raw : JSON.parse(raw);
    const normHost = normalize(hostAddr);
    return parsed
      .map((p) => String(p))
      .filter(Boolean)
      .filter((p) => normalize(p) !== normHost);
  } catch (err) {
    console.warn('[services-monitor] failed to parse R1EN_CHAINSTORE_PEERS', err?.message);
    return [];
  }
}

function normalize(value) {
  return String(value || '').replace(/\/+$/, '');
}

module.exports = { loadConfig, REQUIRED_ENV };
