const { maybeSign } = require('./signing');
const { createTestFile, readR1fsPayload } = require('./utils');
const { shortId } = require('./utils');
const { safeParseJson } = require('./utils');

function startPeerWorker({ sdk, config }) {
  const state = { handledRuns: new Set(), polling: false };
  const intervalMs = 2_000;

  const poll = async () => {
    if (state.polling) return;
    state.polling = true;
    try {
      await scanForRuns({ sdk, config, state });
    } catch (err) {
      console.error('[services-monitor] peer scan failed', err?.message || err);
    } finally {
      state.polling = false;
    }
  };

  setInterval(poll, intervalMs).unref();
  poll().catch((err) => console.error('[services-monitor] initial peer scan failed', err));
}

async function scanForRuns({ sdk, config, state }) {
  const all = await sdk.cstore.hgetall({ hkey: config.hkey }).catch((err) => {
    console.error('[services-monitor] failed to read cstore for peer scan', err?.message);
    return {};
  });

  for (const [key, raw] of Object.entries(all)) {
    if (!key.startsWith('run:')) continue;
    const payload = safeParseJson(raw);
    if (!payload || payload.type !== 'initiator-broadcast') continue;
    if (!config.testMode && payload.initiator === config.hostAddr) continue;
    if (payload.expiresAt && Date.now() > payload.expiresAt) continue;
    if (state.handledRuns.has(payload.runId)) continue;
    state.handledRuns.add(payload.runId);
    if (config.testMode) {
      for (const peer of config.peers) {
        const peerConfig = { ...config, hostAddr: peer };
        handlePeerJob({ sdk, config: peerConfig, runPayload: payload }).catch((err) =>
          console.error('[services-monitor] peer job failed', payload.runId, err?.message)
        );
      }
    } else {
      handlePeerJob({ sdk, config, runPayload: payload }).catch((err) =>
        console.error('[services-monitor] peer job failed', payload.runId, err?.message)
      );
    }
  }
}

async function handlePeerJob({ sdk, config, runPayload }) {
  const { runId, fileCid, startedAt, initiator } = runPayload;
  console.log(
    `[services-monitor][peer ${config.hostAddr}][run ${runId}] handling broadcast from ${initiator} cid=${fileCid}`
  );
  const ackedAt = Date.now();
  const ackPayload = {
    runId,
    peer: config.hostAddr,
    initiator,
    ackedAt,
    ackLatencyMs: startedAt ? ackedAt - startedAt : null,
    runSignature: runPayload.runSignature || null,
    peerSignature: await maybeSign(config, `ack:${runId}:${config.hostAddr}`),
    message: 'I see your post'
  };

  await sdk.cstore.hset({
    hkey: config.hkey,
    key: `ack:${runId}:${config.hostAddr}`,
    value: JSON.stringify(ackPayload)
  });
  console.log(
    `[services-monitor][peer ${config.hostAddr}][run ${runId}] posted ack in ${ackPayload.ackLatencyMs}ms`
  );

  let downloadMs = null;
  let streamMs = null;
  let preview = '';
  let downloadError = null;

  try {
    const downloadStart = Date.now();
    const downloadRes = await sdk.r1fs.getFileFull({ cid: fileCid });
    downloadMs = Date.now() - downloadStart;
    const payload = await readR1fsPayload(downloadRes.result);
    streamMs = payload.streamMs;
    preview = payload.buffer.toString('utf8', 0, Math.min(50, payload.buffer.length));
    console.log(
      `[services-monitor][peer ${config.hostAddr}][run ${runId}] downloaded initiator file in ${downloadMs}ms stream ${streamMs}ms`
    );
  } catch (err) {
    downloadError = err?.message || String(err);
    console.warn(
      `[services-monitor][peer ${config.hostAddr}][run ${runId}] download error: ${downloadError}`
    );
  }

  const peerResult = {
    runId,
    peer: config.hostAddr,
    initiator,
    fileCid,
    ackedAt,
    ackLatencyMs: ackPayload.ackLatencyMs,
    downloadMs,
    streamMs,
    preview,
    error: downloadError,
    recordedAt: Date.now(),
    peerSignature: await maybeSign(config, `peer:${runId}:${config.hostAddr}`)
  };

  await sdk.cstore.hset({
    hkey: config.hkey,
    key: `peer:${runId}:${config.hostAddr}`,
    value: JSON.stringify(peerResult)
  });
  console.log(
    `[services-monitor][peer ${config.hostAddr}][run ${runId}] posted download metrics (error=${downloadError ? 'yes' : 'no'})`
  );

  let reverseCid = null;
  let reverseUploadMs = null;
  let reversePreview = '';
  let reverseError = null;

  try {
    const { buffer, preview: revPreview } = createTestFile(shortId());
    const uploadStart = Date.now();
    const uploadRes = await sdk.r1fs.addFile({
      file: buffer,
      filename: `peer-${config.hostAddr}-${runId}.txt`,
      contentType: 'text/plain'
    });
    reverseCid = uploadRes.cid;
    reverseUploadMs = Date.now() - uploadStart;
    reversePreview = revPreview;
    console.log(
      `[services-monitor][peer ${config.hostAddr}][run ${runId}] uploaded reverse file cid=${reverseCid} in ${reverseUploadMs}ms`
    );
  } catch (err) {
    reverseError = err?.message || String(err);
    console.warn(
      `[services-monitor][peer ${config.hostAddr}][run ${runId}] reverse upload error: ${reverseError}`
    );
  }

  const reversePayload = {
    runId,
    peer: config.hostAddr,
    initiator,
    fileCid: reverseCid,
    uploadedAt: Date.now(),
    uploadMs: reverseUploadMs,
    preview: reversePreview,
    error: reverseError,
    peerSignature: await maybeSign(config, `reverse:${runId}:${config.hostAddr}`)
  };

  await sdk.cstore.hset({
    hkey: config.hkey,
    key: `reverse:${runId}:${config.hostAddr}`,
    value: JSON.stringify(reversePayload)
  });
  console.log(
    `[services-monitor][peer ${config.hostAddr}][run ${runId}] posted reverse payload (error=${reverseError ? 'yes' : 'no'})`
  );
}

module.exports = { startPeerWorker, handlePeerJob };
