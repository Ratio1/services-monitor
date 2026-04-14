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

1. It creates a ~1 MB in-memory text file.
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

If those are not injected, the app falls back to:

- username: `admin`
- password: `r@t100ne-monitor`

Every successful authenticated request starts a new isolated run.

The app only serves authenticated `GET /`. A bare `HEAD /` request is expected to return `404` because there is no separate health endpoint.

## Streamed Output

The response is a streamed HTML log. It includes:

- app version
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
Services Monitor v1.0.1 started on 'dr1-thorn-01' <0xai_1234...abcd> (slot 2, run abc123)
```

Peer lines use the same alias-plus-short-address format once peer payloads arrive in the browser.

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
- Peer aliases are carried in peer-generated CStore payloads, so the earliest peer-detection line may initially show only addresses from `R1EN_CHAINSTORE_PEERS`.
- Browser streaming shortens displayed node addresses to `<first8...last4>`.
- Console logs and warnings keep full node addresses.

## Current Behavior Summary

- normal multipart R1FS uploads: yes
- CStore broadcast round-trip verification: yes
- browser short-address rendering: yes
- server logs preserve full addresses: yes
- version shown in output: yes
- full reverse file payload streamed to browser: no
- artifacts cleaned up at end of run: yes
