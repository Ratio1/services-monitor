const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatNodeDisplay,
  renderPeerDownloadErrorLine,
  renderPeerTransferLine,
  renderPeerReceiveLine,
  renderStartLine,
  verifyBroadcastRoundTrip
} = require('../src/runFlow');

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

test('formatNodeDisplay returns alias plus address when alias is present', () => {
  assert.equal(formatNodeDisplay({ alias: 'dr1-thorn-01', addr: '0xai_abc' }), "'dr1-thorn-01' <0xai_abc>");
});

test('formatNodeDisplay falls back to address when alias is absent', () => {
  assert.equal(formatNodeDisplay({ alias: '', addr: '0xai_abc' }), '0xai_abc');
});

test('formatNodeDisplay keeps the full address for logs', () => {
  assert.equal(
    formatNodeDisplay({ alias: 'dr1-thorn-01', addr: '0x1234567890abcdef' }),
    "'dr1-thorn-01' <0x1234567890abcdef>"
  );
});

test('renderStartLine shortens browser addresses', () => {
  const line = renderStartLine({
    version: '1.0.1',
    hostAlias: 'dr1-thorn-01',
    hostAddr: '0x1234567890abcdef',
    slotId: 2,
    runId: 'run-1'
  });

  assert.match(line, /Services Monitor v1.0.1 started on 'dr1-thorn-01' <0x123456...cdef> \(slot 2, run run-1\)/);
});

test('renderStartLine keeps angle brackets when browser output has no alias', () => {
  const line = renderStartLine({
    version: '1.0.1',
    hostAlias: '',
    hostAddr: '0x1234567890abcdef',
    slotId: 2,
    runId: 'run-1'
  });

  assert.match(line, /Services Monitor v1.0.1 started on <0x123456...cdef> \(slot 2, run run-1\)/);
});

test('renderPeerTransferLine shortens browser addresses without payload markup', () => {
  const line = renderPeerTransferLine({
    peerAlias: 'dr1-thorn-02',
    peer: '0x1234567890abcdef',
    fileCid: 'cid-1'
  });

  assert.match(line, /Streaming payload from &#39;dr1-thorn-02&#39; &lt;0x123456\.\.\.cdef&gt; \(cid-1\) to browser…/);
  assert.doesNotMatch(line, /class="payload"/);
});

test('renderPeerReceiveLine shortens browser addresses and keeps angle brackets', () => {
  const line = renderPeerReceiveLine({
    peerAlias: '',
    peer: '0x1234567890abcdef',
    fileCid: 'cid-1',
    preview: 'hello',
    fetchMs: 12,
    serverStreamMs: 34,
    browserSendMs: 56
  });

  assert.match(
    line,
    /Received file from <0x123456\.\.\.cdef> – download: 0\.01s, stream: 0\.03s, response write: 0\.06s\. Preview: "hello"/
  );
  assert.doesNotMatch(line, /class="payload"/);
});

test('renderPeerDownloadErrorLine shortens browser addresses', () => {
  const line = renderPeerDownloadErrorLine({
    peerAlias: 'dr1-thorn-03',
    peer: '0x1234567890abcdef',
    error: 'boom'
  });

  assert.match(line, /Peer 'dr1-thorn-03' <0x123456\.\.\.cdef> reported an error while downloading: boom/);
});
