const { sleep } = require('./utils');
const { safeParseJson } = require('./utils');

function shouldRetryR1fsUpload(err) {
  const message = String(err?.message || '');
  const causeMessage = String(err?.cause?.message || '');
  return message.includes('fetch failed') || causeMessage.includes('EPIPE');
}

async function uploadBufferToR1fs({ sdk, buffer, filename, secret, nonce }) {
  const payload = {
    file: buffer,
    filename,
    ...(secret ? { secret } : {}),
    ...(nonce !== undefined ? { nonce } : {})
  };

  try {
    return await sdk.r1fs.addFile(payload);
  } catch (err) {
    if (!shouldRetryR1fsUpload(err)) throw err;
    await sleep(250);
    return await sdk.r1fs.addFile(payload);
  }
}

async function waitForPeerData(
  sdk,
  runId,
  config,
  label,
  timeoutMs,
  keyBuilder,
  overallDeadlineMs,
  shouldAbort,
  accept
) {
  const deadline = Math.min(Date.now() + timeoutMs, overallDeadlineMs ?? Number.POSITIVE_INFINITY);
  const results = new Map();

  while (Date.now() < deadline && results.size < config.peers.length) {
    if (shouldAbort?.()) break;
    for (const peer of config.peers) {
      if (results.has(peer)) continue;
      const { hkey, key } = keyBuilder(peer);
      const raw = await sdk.cstore.hget({ hkey, key }).catch(() => null);
      if (!raw) continue;
      const parsed = safeParseJson(raw);
      if (!parsed) continue;
      if (accept && !accept(parsed)) continue;
      results.set(peer, parsed);
    }
    if (results.size >= config.peers.length) break;
    if (shouldAbort?.()) break;
    await sleep(750);
  }

  return config.peers.map((peer) => {
    const payload = results.get(peer);
    if (!payload) {
      return { peer, missing: true, label };
    }
    return { peer, ...payload, label };
  });
}

async function cleanupArtifacts(sdk, config, cids, slotKey, runId) {
  const uniqueCids = Array.from(new Set(cids.filter(Boolean)));
  if (uniqueCids.length > 0) {
    try {
      await sdk.r1fs.deleteFiles({
        cids: uniqueCids,
        cleanup_local_files: true,
        unpin_remote: true,
        run_gc_after_all: true
      });
    } catch (err) {
      console.warn('[services-monitor] failed to delete files', err?.message);
    }
  }

  const cleanupKeys = [
    `run:${slotKey}`,
    ...config.peers.map((p) => `ack:${slotKey}:${p}`),
    ...config.peers.map((p) => `peer:${slotKey}:${p}`),
    ...config.peers.map((p) => `reverse:${slotKey}:${p}`)
  ];

  for (const key of cleanupKeys) {
    try {
      await sdk.cstore.hset({
        hkey: config.hkey,
        key,
        value: JSON.stringify({ runId, slotKey, clearedAt: Date.now() })
      });
    } catch (err) {
      console.warn('[services-monitor] failed to clear cstore key', key, err?.message);
    }
  }
}

module.exports = { waitForPeerData, cleanupArtifacts, uploadBufferToR1fs };
