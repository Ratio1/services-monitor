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
  req.on('close', () => {
    reqClosed.value = true;
  });

  try {
    const ensureNotTimedOut = () => {
      if (Date.now() > abortAt) {
        throw new Error('Run exceeded overall timeout (~3 minutes)');
      }
    };

    await logChunk(res, `Services Monitor started on ${config.hostAddr} (run ${runId})`, 'step');
    if (runSignature) {
      await logChunk(res, 'Derived run signature via cstore-auth hasher', 'muted');
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

    const uploadStart = Date.now();
    const uploadRes = await sdk.r1fs.addFile({
      file: buffer,
      filename: `services-monitor-${runId}.txt`,
      contentType: 'text/plain'
    });
    const uploadMs = Date.now() - uploadStart;
    const initiatorCid = uploadRes.cid;
    await logChunk(
      res,
      `Saved initiator file to R1FS in ${formatMs(uploadMs)} (cid: ${initiatorCid})`,
      'success'
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

    ensureNotTimedOut();

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
      abortAt
    );
    for (const ack of acks) {
      if (ack.missing) {
        await logChunk(
          res,
          `Peer ${ack.peer} did not acknowledge within ${formatMs(config.timeouts.ackMs)}`,
          'error'
        );
        continue;
      }
      await logChunk(
        res,
        `Peer ${ack.peer} responded to CStore message in ${formatMs(ack.ackLatencyMs ?? 0)}`,
        ack.error ? 'error' : 'muted'
      );
    }

    ensureNotTimedOut();

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
      abortAt
    );
    for (const pd of peerDownloads) {
      if (pd.missing) {
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
        await logChunk(
          res,
          `Peer ${pd.peer} reported an error while downloading: ${pd.error}`,
          'error'
        );
        continue;
      }
      await logChunk(
        res,
        `Peer ${pd.peer}: downloaded in ${formatMs(
          pd.downloadMs ?? 0
        )}, streamed to Node.js in ${formatMs(pd.streamMs ?? 0)} (preview: "${pd.preview || 'n/a'}")`,
        'muted'
      );
    }

    ensureNotTimedOut();

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
      abortAt
    );

    const peerFileCids = [];
    for (const reverse of reverseAnnouncements) {
      ensureNotTimedOut();

      if (reverse.missing) {
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
        await logChunk(
          res,
          `Peer ${reverse.peer} reverse upload failed: ${reverse.error || 'no cid provided'}`,
          'error'
        );
        continue;
      }

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
    await logChunk(res, 'Test completed. Cleaned up artifacts.', 'step');
  } catch (err) {
    await logChunk(res, `Run failed: ${err?.message || err}`, 'error');
  } finally {
    if (!reqClosed.value) {
      res.end(buildHtmlFooter());
    }
  }
}

module.exports = { handleRunRequest };
