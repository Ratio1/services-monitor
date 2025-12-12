const { EdgeSdk } = require('@ratio1/edge-sdk-ts');
const { createMockSdk } = require('./mock');
const { REQUIRED_ENV } = require('./config');

function createSdk(config) {
  if (config.testMode) {
    const sdk = createMockSdk(config.hostAddr, config.peers);
    console.log('[services-monitor] running in TEST MODE with in-memory SDK');
    return { sdk, mode: 'test' };
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn(
      '[services-monitor] missing required env vars, falling back to test mode:',
      missing.join(', ')
    );
    const sdk = createMockSdk(config.hostAddr, config.peers);
    return { sdk, mode: 'test' };
  }

  const sdk = new EdgeSdk({ verbose: false });
  return { sdk, mode: 'live' };
}

module.exports = { createSdk };
