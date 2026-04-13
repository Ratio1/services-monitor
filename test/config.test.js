const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../src/config');

test('loadConfig prefers R1EN_HOST_ID as the host alias', () => {
  const originalEnv = { ...process.env };

  process.env.EE_CHAINSTORE_API_URL = 'http://localhost:31234';
  process.env.EE_R1FS_API_URL = 'http://localhost:31235';
  process.env.R1EN_HOST_ADDR = '0xai_abc';
  process.env.R1EN_HOST_ID = 'dr1-thorn-01';
  process.env.R1EN_CHAINSTORE_PEERS = '["0xai_peer"]';

  const config = loadConfig();

  process.env = originalEnv;

  assert.equal(config.hostAlias, 'dr1-thorn-01');
  assert.equal(config.hostAddr, '0xai_abc');
});
