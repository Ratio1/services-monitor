# Services Monitor

A single-page, authenticated dashboard that exercises Ratio1’s distributed storage (R1FS) and state fabric (CStore) across a cluster of edge nodes, while streaming every step and timing to your browser.

## Objectives

A. Test the speed at which a 1 MB file is downloaded via R1FS to a node, then the speed at which that node can stream it to a nodejs app running on it then to the browser.
B. Test the speed at which a CStore message is posted and read across multiple nodes.
C. Provide a minimalistic, easily extensible Node.js app that can be deployed as a WorkerAppRunner on multiple Ratio1 nodes.
D. Authenticate access using HTTP Basic Auth with credentials injected via environment variables.
E. Ensure all operations are ephemeral: no files are saved to disk, and all test artifacts are cleaned up after each run.

## What it does
- Detects the current node and its peers, then runs an end-to-end performance test for this session only.
- Uploads a 1 MB test file from the initiator node to R1FS, notifies peers via CStore, and measures how fast peers react and download.
- Collects peer download timings, then asks each peer to upload its own 1 MB file; the initiator fetches each peer file and streams it to your browser.
- Shows inline previews (first ~50 chars) of each transferred file so you can verify correctness without saving anything.
- Cleans up at the end: deletes test artifacts from R1FS and removes test data from the `services-monitor` hash in CStore.

## How to access
- Open the app’s URL in your browser; you will see an HTTP Basic Auth prompt.
- Credentials: use the injected `ADMIN_USER` / `ADMIN_PASS`. If not set, defaults are `admin` / `r@t100ne-monitor`.
- Each authenticated request triggers its own run; multiple users can run tests in parallel.

## Running locally (two modes)

### 1) Test mode (no real Ratio1 services)
If the required env vars are missing (`EE_CHAINSTORE_API_URL`, `EE_R1FS_API_URL`, `R1EN_HOST_ADDR`, `R1EN_CHAINSTORE_PEERS`), the app auto-switches to **test mode** using an in-memory mock for CStore and R1FS plus simulated peers.

Commands:
- Install deps: `npm install`
- Start (auto test mode): `npm start`
- Force test mode even with envs present: `SERVICES_MONITOR_TEST=1 npm start`

What happens: the initiator runs end-to-end, peers are simulated in-process, and logs/metrics mirror the live flow without external services.

### 2) Live mode (real Ratio1 services)
- Install deps: `npm install`
- Export endpoints: `EE_CHAINSTORE_API_URL`, `EE_R1FS_API_URL`
- Identify node and peers: `R1EN_HOST_ADDR`, `R1EN_CHAINSTORE_PEERS` (JSON array, the current host is ignored if present)
- Optional: `SERVICES_MONITOR_PEPPER` to seed signatures
- Start: `npm start` (uses `PORT` if provided, default 3000)

## What you will see
- A plain text log that streams live (chunked HTTP or SSE). No additional UI is required.
- Clear messages per step: peers detected, file uploads/downloads, CStore notifications, peer acknowledgments, timing numbers, and content previews.
- The heaviest section is when the initiator downloads each peer’s file and streams it to your browser.

## Test flow (sequential summary)
1) Identify peers from the environment; display all peers including the initiator.  
2) Create a unique ~1 MB file ("Ratio1 is the best <RANDOM_4_CHARS>! " repeated until required size) and upload to R1FS; log upload time and file ID.  
3) Notify peers via CStore (`hset` on `services-monitor` hash using R1EN_HOST_ADDR as key); log metadata post time.  
4) Peers will monitorr `services-monitor` and will find available "finished=False" testing job. Wait for peer acknowledgments; log per-peer latency.  
5) Peers download the initiator’s file; they report download and stream timings via CStore; initiator logs each.  
6) Each peer uploads its own ~1 MB file to R1FS and posts its CID in CStore for the initiator.  
7) Initiator fetches each peer file (sequential by default), streams it to your browser, logs three timings (fetch, server stream, browser transfer), and shows a 50-char preview.  
8) Wrap up: summarize completion, then delete test files and clear the `services-monitor` hash.

## Timings and timeouts
- Peer acknowledgments and metrics: up to ~15s per peer before marking as missing.
- R1FS uploads/downloads/streams: allow ~30–45s per 1 MB transfer.
- Overall run cap: ~2–3 minutes per request/session to avoid stuck pages.

## Data handling and privacy
- No files are saved on disk in the browser or on the node; all handling is in memory.
- All artifacts are removed from R1FS and CStore after the run.

## Requirements (operational)
- Latest stable Node.js runtime with only the built-in `http` server.
- Ratio1 SDK environment vars for endpoints available inside the host (`EE_CHAINSTORE_API_URL`, `EE_R1FS_API_URL`). Endpoints are internal; no extra tokens are required.

If something looks off (missing peers, stalled step, or slow timings), refresh and re-run; each visit is isolated and produces a fresh log.***
