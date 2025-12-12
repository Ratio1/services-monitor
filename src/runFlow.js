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
const { waitForPeerData, cleanupArtifacts } = require('./runSupport');

async function handleRunRequest(req, res, { sdk, config }) {
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
      `[services-monitor][run ${runId}] started on ${config.hostAddr} with peers: ${config.peers.join(
        ', '
      ) || 'none'}`
    );
    await logChunk(res, `Services Monitor started on ${config.hostAddr} (run ${runId})`, 'step');
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
    const uploadRes = await sdk.r1fs.addFile({
      file: buffer,
      filename: `services-monitor-${runId}.txt`,
      contentType: 'text/plain'
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
      key: `run:${runId}`,
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

    ensureActive();

    const acks = await waitForPeerData(
      sdk,
      runId,
      config,
      'ack',
      config.timeouts.ackMs,
      (peer) => ({
        hkey: config.hkey,
        key: `ack:${runId}:${peer}`
      }),
      abortAt,
      () => reqClosed.value
    );
    for (const ack of acks) {
      ensureActive();
      if (ack.missing) {
        console.warn(`[services-monitor][run ${runId}] peer ${ack.peer} missing ack`);
        await logChunk(
          res,
          `Peer ${ack.peer} did not acknowledge within ${formatMs(config.timeouts.ackMs)}`,
          'error'
        );
        continue;
      }
      console.log(
        `[services-monitor][run ${runId}] peer ${ack.peer} acked in ${ack.ackLatencyMs}ms`
      );
      await logChunk(
        res,
        `Peer ${ack.peer} responded to CStore message in ${formatMs(ack.ackLatencyMs ?? 0)}`,
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
        key: `peer:${runId}:${peer}`
      }),
      abortAt,
      () => reqClosed.value
    );
    for (const pd of peerDownloads) {
      ensureActive();
      if (pd.missing) {
        console.warn(
          `[services-monitor][run ${runId}] peer ${pd.peer} missing download metrics within timeout`
        );
        await logChunk(
          res,
          `Peer ${pd.peer} did not report download metrics within ${formatMs(
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
          `Peer ${pd.peer} reported an error while downloading: ${pd.error}`,
          'error'
        );
        continue;
      }
      console.log(
        `[services-monitor][run ${runId}] peer ${pd.peer} download=${pd.downloadMs}ms stream=${pd.streamMs}ms`
      );
      await logChunk(
        res,
        `Peer ${pd.peer}: downloaded in ${formatMs(
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
        key: `reverse:${runId}:${peer}`
      }),
      abortAt,
      () => reqClosed.value
    );

    for (const reverse of reverseAnnouncements) {
      ensureActive();

      if (reverse.missing) {
        console.warn(
          `[services-monitor][run ${runId}] peer ${reverse.peer} missing reverse upload announcement`
        );
        await logChunk(
          res,
          `Peer ${reverse.peer} did not post reverse file within ${formatMs(
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
          `Peer ${reverse.peer} reverse upload failed: ${reverse.error || 'no cid provided'}`,
          'error'
        );
        continue;
      }

      console.log(
        `[services-monitor][run ${runId}] reverse file from ${reverse.peer} cid=${reverse.fileCid} uploaded in ${reverse.uploadMs}ms`
      );
      const metadataLatency = reverse.uploadedAt ? Date.now() - reverse.uploadedAt : null;
      await logChunk(
        res,
        `Reverse file announced by ${reverse.peer} (metadata latency: ${
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
        `<div class="line muted">Streaming payload from ${escapeHtml(
          reverse.peer
        )} (${reverse.fileCid}) to browser…</div>`
      );
      await writeChunk(
        res,
        `<pre class="payload" data-peer="${escapeHtml(reverse.peer)}">${escapeHtml(
          payload.buffer.toString('utf8')
        )}</pre>`
      );
      const browserSendMs = Date.now() - browserSendStart;

      peerFileCids.push(reverse.fileCid);

      console.log(
        `[services-monitor][run ${runId}] received reverse from ${reverse.peer} fetch=${fetchMs}ms stream=${serverStreamMs}ms browser=${browserSendMs}ms`
      );
      await logChunk(
        res,
        `Received file from ${reverse.peer} – download: ${formatMs(
          fetchMs
        )}, stream: ${formatMs(serverStreamMs ?? 0)}, browser transfer: ${formatMs(
          browserSendMs
        )}. Preview: "${preview50}"`,
        'success'
      );
    }

    await cleanupArtifacts(sdk, config, [initiatorCid, ...peerFileCids], runId);
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
      await cleanupArtifacts(sdk, config, [initiatorCid, ...peerFileCids], runId).catch(() => {});
      console.log(
        `[services-monitor][run ${runId}] cleanup attempted in finally (${[initiatorCid, ...peerFileCids].filter(Boolean).length} cids)`
      );
    }
    if (!reqClosed.value) {
      res.end(buildHtmlFooter());
    }
  }
}

module.exports = { handleRunRequest };
