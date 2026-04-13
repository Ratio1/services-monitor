const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyBroadcastRoundTrip } = require('../src/runFlow');

test('verifyBroadcastRoundTrip rejects a missing cstore value', async () => {
  await assert.rejects(
    () =>
      verifyBroadcastRoundTrip({
        sdk: {
          cstore: {
            hget: async () => null
          }
        },
        config: { hkey: 'services-monitor' },
        broadcastPayload: {
          runId: 'run-1',
          slotKey: 'host-1',
          fileCid: 'cid-1',
          initiator: 'initiator-1'
        }
      }),
    /CStore round-trip read returned no value/
  );
});

test('verifyBroadcastRoundTrip accepts a matching cstore value', async () => {
  const payload = {
    runId: 'run-2',
    slotKey: 'host-2',
    fileCid: 'cid-2',
    initiator: 'initiator-2'
  };

  const result = await verifyBroadcastRoundTrip({
    sdk: {
      cstore: {
        hget: async () => JSON.stringify(payload)
      }
    },
    config: { hkey: 'services-monitor' },
    broadcastPayload: payload
  });

  assert.equal(result.runId, payload.runId);
  assert.equal(result.slotKey, payload.slotKey);
  assert.equal(result.fileCid, payload.fileCid);
  assert.equal(result.initiator, payload.initiator);
});
