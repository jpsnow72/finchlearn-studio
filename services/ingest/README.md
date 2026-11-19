# finch-ingest: Studio ingest worker (issue #7)

When media is ingested (upload or recording), this service produces the
three artefacts the editor needs, from the ORIGINAL source bytes:

1. `proxy-720p.mp4` — a 720p H.264/AAC proxy (downscale only, faststart)
   for smooth editor scrubbing. Preview prefers the proxy; exports
   never use it (the contract in `packages/media/src/ingest.ts` refuses
   proxy media for export rather than falling back silently).
2. `peaks.json` — waveform peaks in the canonical `packages/media`
   shape: `{ version, buckets, bucketMs, peaks: [{ min, max }] }`,
   normalized 0..1, the same math as `computePeaks`. Shared with the
   silence (#30) and ASR (#43) consumers; no second peaks shape.
3. `thumbs-strip.jpg` — one sprite strip (frames at segment centres,
   timestamps in the manifest) for timeline and scrubber display.

## Contract

The job model, lifecycle (queued / running / done / failed with retry,
max 3 attempts), output manifest, storage keys, dedupe, and source
selection rules live in `packages/media/src/ingest.ts` and are pinned
by its tests. This service mirrors the small pure pieces (job id,
derived keys, plan, peaks math) because it is plain Node outside the
workspace; keep them in step with the package.

Identity is the content hash (SHA-256 hex of the source bytes):

- Job id: `ingest-<hash[0:32]>`
- Derived keys: `derived/<hash[0:2]>/<hash>/proxy-720p.mp4`,
  `derived/<hash[0:2]>/<hash>/peaks.json`,
  `derived/<hash[0:2]>/<hash>/thumbs-strip.jpg`

Re-posting a job for a hash that is queued, running, or done returns
the existing job with `deduped: true` and never re-runs FFmpeg. A
failed job under the attempt cap is requeued on re-post.

## API

- `POST /jobs` — header `x-ingest-key`; body `{sourceR2Key, sourceUrl,
  contentHash, kind, width?, height?, durationMs?, assetId?}` returns
  `{jobId, token, status, deduped}`. `sourceUrl` is a short-lived
  signed https GET URL for the original, issued by the caller through
  the finch-media Worker; this service holds no R2 credentials.
- `GET /jobs/:id` — ingest key or job token returns `{jobId, status,
  attempts, error, outputs}` where `outputs` is the manifest from the
  media contract (proxy / peaks / thumbnails / probed).
- `GET /jobs/:id/file/<artefact>?token=<token>` — one artefact file
  (`proxy-720p.mp4`, `peaks.json`, or `thumbs-strip.jpg`), only when
  the job is done.
- `GET /health`

Caps: one job at a time, 10 minute job timeout, 2 GB source cap,
finished job files swept after 24 hours.

## Deploy (VPS, Ubuntu 24.04, alongside finch-render)

Target location: this directory deploys to `/opt/finch-ingest` on the
InterServer VPS (the same host as finch-render, which already runs
FFmpeg there). It does not deploy from this repo's Cloudflare Pages
build and holds no database; no migration is involved.

1. Install: `ffmpeg` (already present for finch-render), Node 22 at
   /opt/node22 (already present). No npm dependencies.
2. Copy this directory to `/opt/finch-ingest`.
3. `/opt/finch-ingest/ingest.env` with `INGEST_KEY=<random>` (600
   perms). The same value goes into the editor build as
   `VITE_INGEST_KEY` alongside
   `VITE_INGEST_URL=https://ingest.finchlearn.com`. Secret names only:
   `INGEST_KEY` / `VITE_INGEST_KEY`, `VITE_INGEST_URL`.
4. `finch-ingest.service` to `/etc/systemd/system/`, enable and start.
   The service listens on 127.0.0.1:8799 (verify the port is free on
   the box at deploy time; finch-render uses 8797).
5. TLS and reverse proxy: `nginx-ingest.conf` to
   `/etc/nginx/sites-available/ingest` and
   `certbot --nginx -d ingest.finchlearn.com`. DNS:
   `ingest.finchlearn.com` A record to the VPS, DNS-only.
6. Ship-point R2 step: the worker returns artefacts under their
   derived keys; storing them into R2 at those keys (so the editor can
   resolve them through the finch-media Worker like other library
   media) is wired at ship time, either by the media worker pulling
   completed jobs or by adding an upload grant step. Until that step
   lands, artefacts are served by this service's file route and the
   editor falls back to the original for preview, never for export
   correctness (export always uses the original anyway).
