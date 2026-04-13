const {
  buildHtmlFooter,
  buildHtmlPreamble,
  createTestFile,
  escapeHtml,
  formatMs,
  logChunk,
  readR1fsPayload,
  shortId,
  writeChunk
} = require('./utils');
const { maybeSign } = require('./signing');
const { waitForPeerData, cleanupArtifacts, uploadBufferToR1fs } = require('./runSupport');

function formatNodeDisplay({ alias, addr }) {
  if (alias && addr) {
    return `'${alias}' <${addr}>`;
  }
  return alias || addr || 'unknown-node';
}

function renderStartLine({ version, hostAlias, hostAddr, slotId, runId }) {
  return `Services Monitor v${version} started on ${formatNodeDisplay({
    alias: hostAlias,
    addr: hostAddr
  })} (slot ${slotId}, run ${runId})`;
}

function renderPeerTransferLine({ peerAlias, peer, fileCid }) {
  return `<div class="line muted">Streaming payload from ${escapeHtml(
    formatNodeDisplay({ alias: peerAlias, addr: peer })
  )} (${escapeHtml(fileCid)}) to browser…</div>`;
}

async function verifyBroadcastRoundTrip({ sdk, config, broadcastPayload }) {
  const key = `run:${broadcastPayload.slotKey}`;
  const raw = await sdk.cstore.hget({
    hkey: config.hkey,
    key
  });

  if (!raw) {
    throw new Error('CStore round-trip read returned no value');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`CStore round-trip read returned invalid JSON: ${err.message}`);
  }

  const matchesBroadcast =
    parsed.runId === broadcastPayload.runId &&
    parsed.slotKey === broadcastPayload.slotKey &&
    parsed.fileCid === broadcastPayload.fileCid &&
    parsed.initiator === broadcastPayload.initiator;

  if (!matchesBroadcast) {
    throw new Error('CStore round-trip read did not match the written broadcast payload');
  }

  return parsed;
}

async function handleRunRequest(req, res, { sdk, config, slotId }) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Transfer-Encoding': 'chunked'
  });
  res.write(buildHtmlPreamble());

  const abortAt = Date.now() + config.timeouts.overallMs;
  const runId = `${Date.now().toString(36)}-${shortId()}`;
  const runSignature = await maybeSign(config, `run:${runId}`);
  const slotKey = `${config.hostAddr}-${slotId || 0}`;
  const reqClosed = { value: false };
  let initiatorCid = null;
  const peerFileCids = [];
  let cleaned = false;
  req.on('close', () => {
    reqClosed.value = true;
    console.warn(`[services-monitor][run ${runId}] client disconnected; will abort soon`);
  });

  try {
    const ensureActive = () => {
      if (reqClosed.value) {
        throw new Error('Client disconnected; aborting run');
      }
      if (Date.now() > abortAt) {
        throw new Error('Run exceeded overall timeout (~3 minutes)');
      }
    };

    ensureActive();
    console.log(
      `[services-monitor][run ${runId}] started on ${formatNodeDisplay({
        alias: config.hostAlias,
        addr: config.hostAddr
      })} slot ${slotId} with peers: ${
        config.peers.join(', ') || 'none'
      }`
    );
    await logChunk(
      res,
      renderStartLine({
        version: config.version,
        hostAlias: config.hostAlias,
        hostAddr: config.hostAddr,
        slotId,
        runId
      }),
      'step'
    );
    if (runSignature) {
      await logChunk(res, 'Derived run signature via cstore-auth hasher', 'muted');
      console.log(`[services-monitor][run ${runId}] derived run signature`);
    }

    await logChunk(
      res,
      config.peers.length
        ? `Peers detected: ${config.peers.join(', ')}`
        : 'No peers detected in R1EN_CHAINSTORE_PEERS',
      'muted'
    );

    const testSeed = shortId();
    const { buffer, preview } = createTestFile(testSeed);
    await logChunk(res, `Created ~1MB test file (seed ${testSeed}, preview: "${preview}")`, 'muted');
    console.log(`[services-monitor][run ${runId}] created test file (seed ${testSeed})`);

    const uploadStart = Date.now();
    const uploadRes = await uploadBufferToR1fs({
      sdk,
      buffer,
      filename: `services-monitor-${runId}.txt`,
    });
    const uploadMs = Date.now() - uploadStart;
    initiatorCid = uploadRes.cid;
    await logChunk(
      res,
      `Saved initiator file to R1FS in ${formatMs(uploadMs)} (cid: ${initiatorCid})`,
      'success'
    );
    console.log(
      `[services-monitor][run ${runId}] uploaded initiator file cid=${initiatorCid} in ${uploadMs}ms`
    );

    const broadcastStart = Date.now();
    const broadcastPayload = {
      type: 'initiator-broadcast',
      runId,
      initiator: config.hostAddr,
      slotKey,
      slotId,
      fileCid: initiatorCid,
      preview,
      startedAt: broadcastStart,
      createdAt: new Date(broadcastStart).toISOString(),
      expiresAt: broadcastStart + config.timeouts.overallMs,
      peers: config.peers,
      runSignature
    };
    await sdk.cstore.hset({
      hkey: config.hkey,
      key: `run:${slotKey}`,
      value: JSON.stringify(broadcastPayload)
    });
    const broadcastMs = Date.now() - broadcastStart;
    await logChunk(
      res,
      `Posted file notification to CStore in ${formatMs(broadcastMs)}`,
      'success'
    );
    console.log(
      `[services-monitor][run ${runId}] posted broadcast to cstore in ${broadcastMs}ms (expires at ${broadcastPayload.expiresAt})`
    );
    const verifiedBroadcast = await verifyBroadcastRoundTrip({
      sdk,
      config,
      broadcastPayload
    });
    await logChunk(
      res,
      `Verified CStore round-trip for run:${slotKey} (runId ${verifiedBroadcast.runId})`,
      'success'
    );
    console.log(
      `[services-monitor][run ${runId}] verified cstore round-trip for run:${slotKey}`
    );

    ensureActive();

    const acks = await waitForPeerData(
      sdk,
      runId,
      config,
      'ack',
      config.timeouts.ackMs,
      (peer) => ({
        hkey: config.hkey,
        key: `ack:${slotKey}:${peer}`
      }),
      abortAt,
      () => reqClosed.value,
      (payload) => payload.runId === runId && (!payload.slotKey || payload.slotKey === slotKey)
    );
    for (const ack of acks) {
      ensureActive();
      const peerDisplay = formatNodeDisplay({ alias: ack.peerAlias, addr: ack.peer });
      if (ack.missing) {
        console.warn(`[services-monitor][run ${runId}] peer ${ack.peer} missing ack`);
        await logChunk(
          res,
          `Peer ${peerDisplay} did not acknowledge within ${formatMs(config.timeouts.ackMs)}`,
          'error'
        );
        continue;
      }
      console.log(
        `[services-monitor][run ${runId}] peer ${peerDisplay} acked in ${ack.ackLatencyMs}ms`
      );
      await logChunk(
        res,
        `Peer ${peerDisplay} responded to CStore message in ${formatMs(ack.ackLatencyMs ?? 0)}`,
        ack.error ? 'error' : 'muted'
      );
    }

    ensureActive();

    const peerDownloads = await waitForPeerData(
      sdk,
      runId,
      config,
      'peer',
      config.timeouts.downloadMs,
      (peer) => ({
        hkey: config.hkey,
        key: `peer:${slotKey}:${peer}`
      }),
      abortAt,
      () => reqClosed.value,
      (payload) => payload.runId === runId && (!payload.slotKey || payload.slotKey === slotKey)
    );
    for (const pd of peerDownloads) {
      ensureActive();
      const peerDisplay = formatNodeDisplay({ alias: pd.peerAlias, addr: pd.peer });
      if (pd.missing) {
        console.warn(
          `[services-monitor][run ${runId}] peer ${pd.peer} missing download metrics within timeout`
        );
        await logChunk(
          res,
          `Peer ${peerDisplay} did not report download metrics within ${formatMs(
            config.timeouts.downloadMs
          )}`,
          'error'
        );
        continue;
      }
      if (pd.error) {
        console.warn(`[services-monitor][run ${runId}] peer ${pd.peer} reported download error`, pd.error);
        await logChunk(
          res,
          `Peer ${peerDisplay} reported an error while downloading: ${pd.error}`,
          'error'
        );
        continue;
      }
      console.log(
        `[services-monitor][run ${runId}] peer ${peerDisplay} download=${pd.downloadMs}ms stream=${pd.streamMs}ms`
      );
      await logChunk(
        res,
        `Peer ${peerDisplay}: downloaded in ${formatMs(
          pd.downloadMs ?? 0
        )}, streamed to Node.js in ${formatMs(pd.streamMs ?? 0)} (preview: "${pd.preview || 'n/a'}")`,
        'muted'
      );
    }

    ensureActive();

    const reverseAnnouncements = await waitForPeerData(
      sdk,
      runId,
      config,
      'reverse',
      config.timeouts.reverseMs,
      (peer) => ({
        hkey: config.hkey,
        key: `reverse:${slotKey}:${peer}`
      }),
      abortAt,
      () => reqClosed.value,
      (payload) => payload.runId === runId && (!payload.slotKey || payload.slotKey === slotKey)
    );

    for (const reverse of reverseAnnouncements) {
      ensureActive();
      const peerDisplay = formatNodeDisplay({ alias: reverse.peerAlias, addr: reverse.peer });

      if (reverse.missing) {
        console.warn(
          `[services-monitor][run ${runId}] peer ${reverse.peer} missing reverse upload announcement`
        );
        await logChunk(
          res,
          `Peer ${peerDisplay} did not post reverse file within ${formatMs(
            config.timeouts.reverseMs
          )}`,
          'error'
        );
        continue;
      }
      if (reverse.error || !reverse.fileCid) {
        console.warn(
          `[services-monitor][run ${runId}] peer ${reverse.peer} reverse upload failed: ${reverse.error}`
        );
        await logChunk(
          res,
          `Peer ${peerDisplay} reverse upload failed: ${reverse.error || 'no cid provided'}`,
          'error'
        );
        continue;
      }

      console.log(
        `[services-monitor][run ${runId}] reverse file from ${peerDisplay} cid=${reverse.fileCid} uploaded in ${reverse.uploadMs}ms`
      );
      const metadataLatency = reverse.uploadedAt ? Date.now() - reverse.uploadedAt : null;
      await logChunk(
        res,
        `Reverse file announced by ${peerDisplay} (metadata latency: ${
          metadataLatency ? formatMs(metadataLatency) : 'n/a'
        })`,
        'muted'
      );

      const fetchStart = Date.now();
      const r1fsRes = await sdk.r1fs.getFileFull({ cid: reverse.fileCid });
      const fetchMs = Date.now() - fetchStart;
      const payload = await readR1fsPayload(r1fsRes.result);
      const serverStreamMs = payload.streamMs;
      const preview50 = payload.buffer.toString('utf8', 0, Math.min(50, payload.buffer.length));

      const browserSendStart = Date.now();
      await writeChunk(
        res,
        renderPeerTransferLine({
          peerAlias: reverse.peerAlias,
          peer: reverse.peer,
          fileCid: reverse.fileCid
        })
      );
      const browserSendMs = Date.now() - browserSendStart;

      peerFileCids.push(reverse.fileCid);

      console.log(
        `[services-monitor][run ${runId}] received reverse from ${peerDisplay} fetch=${fetchMs}ms stream=${serverStreamMs}ms response=${browserSendMs}ms`
      );
      await logChunk(
        res,
        `Received file from ${peerDisplay} – download: ${formatMs(
          fetchMs
        )}, stream: ${formatMs(serverStreamMs ?? 0)}, response write: ${formatMs(
          browserSendMs
        )}. Preview: "${preview50}"`,
        'success'
      );
    }

    await cleanupArtifacts(sdk, config, [initiatorCid, ...peerFileCids], slotKey, runId);
    cleaned = true;
    console.log(
      `[services-monitor][run ${runId}] cleaned artifacts (${[initiatorCid, ...peerFileCids].filter(Boolean).length} cids)`
    );
    await logChunk(res, 'Test completed. Cleaned up artifacts.', 'step');
  } catch (err) {
    console.error(`[services-monitor][run ${runId}] failed`, err?.message || err);
    await logChunk(res, `Run failed: ${err?.message || err}`, 'error');
  } finally {
    if (!cleaned) {
      await cleanupArtifacts(sdk, config, [initiatorCid, ...peerFileCids], slotKey, runId).catch(
        () => {}
      );
      console.log(
        `[services-monitor][run ${runId}] cleanup attempted in finally (${[initiatorCid, ...peerFileCids].filter(Boolean).length} cids)`
      );
    }
    if (!reqClosed.value) {
      res.end(buildHtmlFooter());
    }
  }
}

module.exports = {
  formatNodeDisplay,
  handleRunRequest,
  renderPeerTransferLine,
  renderStartLine,
  verifyBroadcastRoundTrip
};
