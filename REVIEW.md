# Services Monitor Review

This captures how the app behaves in both roles and how the current code aligns to the specs described in the markdown docs.

## Modes and setup
- Config is loaded from env (`src/config.js`), defaulting ADMIN_USER/PASS to `admin`/`r@t100ne-monitor`, setting the hash key to `services-monitor`, and deriving peer addresses from `R1EN_CHAINSTORE_PEERS` (test mode injects `peer-a/b/c` and host `initiator-local`).
- If required Ratio1 env vars are missing or `SERVICES_MONITOR_TEST=1` is set, the app switches to test mode and uses the in-memory mock SDK; otherwise it uses `@ratio1/edge-sdk-ts`.
- A background peer worker starts on boot (`server.js` → `startPeerWorker`) to react to broadcasts from other nodes.

## Initiator request flow (`src/runFlow.js`)
1) A GET `/` request is basic-authenticated (defaults above). On success the response is set to chunked HTML and a run id/signature are generated with an overall timeout (180s).
2) Peers are announced to the log, then a ~1MB file is built via `createTestFile` with a random seed and preview.
3) The initiator uploads the file to R1FS (`r1fs.addFile`), measures the duration, and logs the CID.
4) It broadcasts run metadata to CStore under `run:<runId>` including initiator host, CID, preview, expiry, peer list, and optional signature.
5) It waits up to `ackMs` (15s) for each peer to write `ack:<runId>:<peer>`, logging per-peer latency or timeout.
6) It then waits up to `downloadMs` (45s) for peer download metrics at `peer:<runId>:<peer>`, logging download/stream timings or errors.
7) Next it waits up to `reverseMs` (60s) for peers to announce their reverse uploads at `reverse:<runId>:<peer>`.
8) For each reverse payload received, it computes metadata latency, downloads the peer file from R1FS, records fetch/stream timings, streams the full payload to the browser (hidden `<pre>` block) while timing the server→browser transfer, and logs a 50-char preview.
9) After processing peers it calls `cleanupArtifacts` to delete initiator and peer CIDs via R1FS and overwrites related CStore keys with cleared markers, then ends the HTML log.

## Receiver/worker flow (`src/peerWorker.js`)
1) Every 2s, the worker polls the `services-monitor` hash via `hgetall`. It ignores expired runs, runs it has already handled, and (in live mode) runs it originated itself.
2) On a new run, it immediately writes `ack:<runId>:<peer>` with ack time/latency, optional signature, and the “I see your post” message.
3) It downloads the initiator’s file from R1FS, measures download and stream timings, captures a preview, and posts metrics to `peer:<runId>:<peer>`.
4) It generates its own ~1MB file, uploads to R1FS measuring upload time, and posts `reverse:<runId>:<peer>` with CID, preview, timestamp, uploadMs, and optional signature.
5) In test mode, this flow is simulated in-process for each synthetic peer using the mock SDK so the initiator sees peer activity without external services.

## Timeouts, UI, and data handling
- Defaults: ack 15s, peer download 45s, reverse uploads 60s, overall 180s; run payloads carry `expiresAt` accordingly.
- UI is a dark, monospace streaming log (chunked HTML), showing step messages plus previews; reverse file contents are also streamed in hidden `<pre>` blocks.
- All files are kept in memory; cleanup attempts to delete R1FS CIDs and mark CStore keys as cleared so runs stay ephemeral.
