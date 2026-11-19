# finch-asr — Studio speech recognition service (issue #43)

Automatic speech recognition with word level timestamps for voice
clips and speech footage at ingest. The browser never runs ASR: the
editor and the media ingest worker queue jobs here, this service
extracts audio with FFmpeg and calls the recognition engine, and the
finished ClipTranscript is stored back on the clip under
`extensions["x-finch-studio"].transcript` (the contract lives in
`packages/media/src/transcript.ts`).

## Target location

The InterServer VPS, alongside finch-render: `/opt/finch-asr`,
public name `asr.finchlearn.com`, service port 8799 on localhost
behind nginx. This lane built the service in-tree only; deploying it
is ship point work (see the lane MANIFEST).

## API

- `POST /jobs` — header `x-asr-key`; body `{clipId, contentHash, r2Key?, sourceUrl?, language?}` → `202 {jobId}`. Queueing is idempotent per (clipId, contentHash) while a job is in flight.
- `GET /jobs/:id` — header `x-asr-key` → `{jobId, state, error, transcript}` where state is queued, transcribing, done, or error. `transcript` is the ready ClipTranscript on done, otherwise null.
- `GET /health` → `{ok, queued, running}`

Jobs run one at a time. The caller mints a short lived signed
`sourceUrl` for the clip's `r2Key` (the finch-media Worker already
mints HMAC download links for Studio exports; the same mechanism
covers ASR fetches). The service verifies nothing about the URL
beyond fetching it, and deletes job files as soon as a job settles.

## Engine

First binding: an OpenAI Whisper style endpoint,
`POST {WHISPER_API_URL}/audio/transcriptions` with
`response_format=verbose_json` and word plus segment timestamp
granularities. The binding is swappable: a self hosted compatible
endpoint only changes `WHISPER_API_URL` and `WHISPER_MODEL`, and a
different engine family replaces the one `transcribeWithWhisper`
function behind the same job API.

## Deploy (VPS, Ubuntu 24.04)

1. Install: `ffmpeg`, Node 22 at /opt/node22 (already present for finch-render).
2. Copy this directory to `/opt/finch-asr`. No `npm install` needed; there are no dependencies.
3. `/opt/finch-asr/asr.env` (600 perms) with the secret NAMES below set to real values. Values never live in this repo.
   - `ASR_KEY` — shared key; the same value goes into the editor build as `VITE_ASR_KEY` alongside `VITE_ASR_URL=https://asr.finchlearn.com`.
   - `OPENAI_API_KEY` — engine key for the Whisper style binding.
   - Optional: `WHISPER_API_URL`, `WHISPER_MODEL`.
4. `finch-asr.service` → `/etc/systemd/system/`, enable + start.
5. TLS/reverse proxy: `nginx-asr.conf` → `/etc/nginx/sites-available/asr` and `certbot --nginx -d asr.finchlearn.com`. DNS: `asr.finchlearn.com` A → the VPS, DNS-only.
6. Proof: queue a real voice clip, poll until done, and confirm the returned transcript carries word level timestamps and the job's content hash.
