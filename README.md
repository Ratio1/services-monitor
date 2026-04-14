# Services Monitor

`services-monitor` is a small authenticated Worker App Runner application for validating live Ratio1 storage behavior across multiple edge nodes.

It is meant to answer a narrow operational question:

- can one node upload a test file to R1FS
- announce it through CStore
- have peers acknowledge and download it
- have peers upload their own reverse files
- and have the initiator verify the reverse leg and cleanup

The app is intentionally simple, streamed, and ephemeral. Every authenticated request creates a fresh run and removes its test artifacts at the end.

## Objectives

- Validate end-to-end R1FS behavior using the normal multipart SDK upload path.
- Validate CStore propagation and immediate round-trip reads for a shared HSET.
- Show per-step timings and node identity so live cluster behavior is easy to inspect.
- Provide a small Node.js app that is easy to deploy on multiple edge nodes through Worker App Runner.
- Keep the test ephemeral: no persistent browser files, no intended permanent R1FS artifacts, and CStore keys overwritten during cleanup.

## What It Tests

For each authenticated request, one node becomes the initiator for that run:

1. It creates an exact 1 MiB in-memory text file.
2. It uploads that file to R1FS using the standard SDK `addFile()` multipart path.
3. It posts a CStore broadcast in the `services-monitor` HSET.
4. It immediately verifies that broadcast with a local CStore round-trip read.
5. Peer nodes observe the broadcast, acknowledge it through CStore, and download the initiator file.
6. Each peer uploads its own reverse file to R1FS and posts its CID back through CStore.
7. The initiator fetches each reverse file, reports timings, and shows a short preview in the streamed response.
8. The initiator deletes the created R1FS artifacts and overwrites the run-specific CStore keys with cleanup markers.

The browser output shows status lines, timings, CIDs, and previews. It does not send the full reverse file payload to the browser.
Server logs keep the full node addresses for troubleshooting.

## Access

Live devnet entrypoint:

- `https://devnet-services-monitor.ratio1.link/`

Legacy or migration tunnel aliases may still exist temporarily, but the devnet alias above is the canonical public URL.

The app uses HTTP Basic Auth:

- username: `ADMIN_USER`
- password: `ADMIN_PASS`

If those are not injected, the app falls back to dev environment credentials:

- username: `admin`
- password: `r@t100ne-monitor`

Every successful authenticated request starts a new isolated run.

The app only serves authenticated `GET /`. A bare `HEAD /` request is expected to return `404` because there is no separate health endpoint.

## Streamed Output

The response is a streamed HTML log. It includes:

- app version
- an immediate bootstrap line so the browser has visible output before uploads and peer waits begin
- initiator identity rendered as `'alias' <first8...last4>` in browser output
- raw peer detection information from `R1EN_CHAINSTORE_PEERS`
- CStore verification status
- per-peer acknowledgment timing
- per-peer download timing
- reverse-upload announcements
- reverse-file fetch timing and short previews
- cleanup result

Example start line:

```text
Services Monitor v1.0.2 started on 'dr1-thorn-01' <0xai_1234...abcd> (slot 2, run abc123)
```

Peer lines use the same alias-plus-short-address format once peer payloads arrive in the browser.
The first streamed response chunk is intentionally padded so common ingress/browser buffering does not leave the page blank while the run warms up.

## Runtime Identity And Environment

The app relies on the environment injected by Worker App Runner.

Important variables:

- `EE_CHAINSTORE_API_URL`: local CStore API endpoint
- `EE_R1FS_API_URL`: local R1FS API endpoint
- `R1EN_HOST_ADDR`: long node address used as the canonical initiator/peer address
- `R1EN_HOST_ID`: human-readable edge-node alias used for display
- `R1EN_CHAINSTORE_PEERS`: JSON array of peer addresses
- `SERVICES_MONITOR_PEPPER`: optional seed for cstore-auth signing helpers
- `ADMIN_USER` / `ADMIN_PASS`: optional Basic Auth credentials

Compatibility fallback:

- if `R1EN_HOST_ID` is missing, the app falls back to `EE_HOST_ID`

## Worker App Runner Sizing

If you deploy `services-monitor` on the Deeploy generic Worker App Runner tiers, use `LITE` as the minimum recommended size:

- `LITE`: `0.5` CPU, `1 GB` RAM, `4 GB` storage

Why this is the floor:

- the app is small on disk and has no real build step
- it still runs a live Node.js HTTP server plus the 2-second background peer scan
- each run creates an exact `1 MiB` in-memory payload and performs R1FS upload and download work
- the server allows up to four concurrent active runs on one node

`MICRO` may start the app, but it leaves too little CPU and memory headroom for predictable live behavior. If you expect heavier peer activity or you want more margin for the current four-slot concurrency model, move up to `ENTRY`.

## Coordination Model

All live instances coordinate through one shared CStore hash:

```text
hkey = services-monitor
```

The app does not create one hash per node or one hash per run. Each instance writes fields into the same hash and uses field names as the protocol namespace.

### Key Structure

For one active run, the field names follow this pattern:

```text
run:${slotKey}
ack:${slotKey}:${peerAddr}
peer:${slotKey}:${peerAddr}
reverse:${slotKey}:${peerAddr}
```

Example:

```text
run:0xai_INITIATOR-2
ack:0xai_INITIATOR-2:0xai_PEER
peer:0xai_INITIATOR-2:0xai_PEER
reverse:0xai_INITIATOR-2:0xai_PEER
```

Each key family has one job:

- `run:*`: initiator broadcast that tells peers a new run exists
- `ack:*`: peer acknowledgment that it saw the broadcast
- `peer:*`: peer download result for the initiator file
- `reverse:*`: peer reverse-upload announcement for the file the initiator should fetch back

### Payload Contract

The values are JSON strings.

The initiator writes `run:${slotKey}` with a payload like:

```json
{
  "type": "initiator-broadcast",
  "runId": "mnyoo59r-2923388e",
  "initiator": "0xai_AhclX8pEpqk-E4QiEFoU5QuySrZsrUqoOFMhyFO0ZmAm",
  "slotKey": "0xai_AhclX8pEpqk-E4QiEFoU5QuySrZsrUqoOFMhyFO0ZmAm-2",
  "slotId": 2,
  "fileCid": "Qm...",
  "preview": "Ratio1 is the best ...",
  "startedAt": 1776174892342,
  "createdAt": "2026-04-14T13:54:52.342Z",
  "expiresAt": 1776175072342,
  "peers": ["0xai_AsOOL9OyvlbaZ8SG6KvhebJcqZd9HA765GWNCTdnilgA"],
  "runSignature": "argon2id:..."
}
```

A peer writes `ack:${slotKey}:${peerAddr}` with:

```json
{
  "runId": "mnyoo59r-2923388e",
  "peer": "0xai_AsOOL9OyvlbaZ8SG6KvhebJcqZd9HA765GWNCTdnilgA",
  "peerAlias": "dr1-thorn-02-4c",
  "initiator": "0xai_AhclX8pEpqk-E4QiEFoU5QuySrZsrUqoOFMhyFO0ZmAm",
  "slotKey": "0xai_AhclX8pEpqk-E4QiEFoU5QuySrZsrUqoOFMhyFO0ZmAm-2",
  "ackedAt": 1776174893341,
  "ackLatencyMs": 999,
  "runSignature": "argon2id:...",
  "peerSignature": "argon2id:...",
  "message": "I see your post"
}
```

A peer writes `peer:${slotKey}:${peerAddr}` with:

```json
{
  "runId": "mnyoo59r-2923388e",
  "peer": "0xai_AsOOL9OyvlbaZ8SG6KvhebJcqZd9HA765GWNCTdnilgA",
  "peerAlias": "dr1-thorn-02-4c",
  "initiator": "0xai_AhclX8pEpqk-E4QiEFoU5QuySrZsrUqoOFMhyFO0ZmAm",
  "slotKey": "0xai_AhclX8pEpqk-E4QiEFoU5QuySrZsrUqoOFMhyFO0ZmAm-2",
  "fileCid": "Qm...",
  "ackedAt": 1776174893341,
  "ackLatencyMs": 999,
  "downloadMs": 545,
  "streamMs": 8,
  "preview": "Ratio1 is the best ...",
  "error": null,
  "recordedAt": 1776174894605,
  "peerSignature": "argon2id:..."
}
```

A peer writes `reverse:${slotKey}:${peerAddr}` with:

```json
{
  "runId": "mnyoo59r-2923388e",
  "peer": "0xai_AsOOL9OyvlbaZ8SG6KvhebJcqZd9HA765GWNCTdnilgA",
  "peerAlias": "dr1-thorn-02-4c",
  "initiator": "0xai_AhclX8pEpqk-E4QiEFoU5QuySrZsrUqoOFMhyFO0ZmAm",
  "slotKey": "0xai_AhclX8pEpqk-E4QiEFoU5QuySrZsrUqoOFMhyFO0ZmAm-2",
  "fileCid": "Qm_reverse...",
  "uploadedAt": 1776174896430,
  "uploadMs": 1032,
  "preview": "Ratio1 is the best ...",
  "error": null,
  "peerSignature": "argon2id:..."
}
```

### Slot Model

`R1EN_HOST_ADDR` identifies the node. It does not identify one browser request.

The server allows up to four concurrent runs per node. Each accepted request gets a `slotId` from `1..4`. The app builds:

```text
slotKey = ${hostAddr}-${slotId}
```

That gives each active run on a node its own key namespace.

Why the app needs `slotKey`:

- one node can serve more than one browser request at the same time
- `hostAddr` alone would make concurrent runs overwrite the same `run:*`, `ack:*`, `peer:*`, and `reverse:*` fields
- `slotKey` separates active runs on the same node

The app also carries `runId` inside every payload. `runId` is the per-request identifier. `slotKey` is the per-node active lane. Reads check both so a newly reused slot does not accidentally accept stale data from an older run.

### Polling Model

Two polling patterns exist in live mode.

Peer discovery:

- every instance runs a background peer worker
- every 2 seconds that worker calls `hgetall(services-monitor)`
- it scans the shared hash for `run:*` entries with `type = initiator-broadcast`
- it skips broadcasts that came from the same node

Per-run waits:

- once an initiator starts a run, it switches to targeted `hget()` polling
- it polls for `ack:${slotKey}:${peer}`
- then `peer:${slotKey}:${peer}`
- then `reverse:${slotKey}:${peer}`

This is why the CStore logs look chatty even when only two nodes participate in the run. The live coordination itself is point-to-point between the initiator and its listed peers, but every instance also performs the background full-hash scan.

### Cleanup Behavior

Cleanup is overwrite-based, not delete-based.

At the end of a run, the app rewrites the run-specific fields with tombstones like:

```json
{
  "runId": "mnyoo59r-2923388e",
  "slotKey": "0xai_AhclX8pEpqk-E4QiEFoU5QuySrZsrUqoOFMhyFO0ZmAm-2",
  "clearedAt": 1776174900552
}
```

This keeps the protocol simple and leaves a short operational trace in CStore, but it also means the background `hgetall()` scan can still see historical fields until something else clears or replaces them.

## Local Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Start the app:

```bash
npm start
```

The repo also exposes a no-op build script because Worker App Runner currently runs `npm run build` during deployment:

```bash
npm run build
```

## Modes

### Test Mode

If the required live env vars are missing, the app automatically falls back to an in-memory test mode.

Required live variables:

- `EE_CHAINSTORE_API_URL`
- `EE_R1FS_API_URL`
- `R1EN_HOST_ADDR`
- `R1EN_CHAINSTORE_PEERS`

You can also force test mode explicitly:

```bash
SERVICES_MONITOR_TEST=1 npm start
```

In test mode:

- CStore and R1FS are mocked in-process
- peers are simulated
- the app still exercises the same high-level flow

### Live Mode

In live mode the app talks to the real local edge APIs exposed to the worker container:

- R1FS uploads use normal SDK multipart `addFile()`
- the app retries a single transient upload reset such as `EPIPE`, `ECONNRESET`, or `socket hang up`
- CStore writes use `hset()` / `hget()` / `hgetall()`
- peer coordination happens through the shared `services-monitor` HSET

## Operational Notes

- The app is designed for diagnostics, not long-term storage.
- Cleanup is best-effort. Failures are logged, but the run still completes its response.
- The public ingress can still fail independently of app health. A `502` at the public alias does not automatically mean the worker app is broken.
- The first streamed chunk is padded to 4 KiB and headers disable proxy buffering where supported, which reduces blank-page delays before the first visible browser line.
- Peer aliases are carried in peer-generated CStore payloads, so the earliest peer-detection line may initially show only addresses from `R1EN_CHAINSTORE_PEERS`.
- Browser streaming shortens displayed node addresses to `<first8...last4>`.
- Client disconnects abort the run and cleanup without attempting additional writes to the destroyed response stream.
- Console logs and warnings keep full node addresses.

## Current Behavior Summary

- normal multipart R1FS uploads: yes
- CStore broadcast round-trip verification: yes
- exact 1 MiB test payload generation: yes
- bootstrap chunk sized for fast first paint: yes
- browser short-address rendering: yes
- disconnect-safe streamed error handling: yes
- server logs preserve full addresses: yes
- version shown in output: yes
- full reverse file payload streamed to browser: no
- artifacts cleaned up at end of run: yes
