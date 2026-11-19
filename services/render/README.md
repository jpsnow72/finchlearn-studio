# finch-render — Studio server renderer (issue #33)

Headless Chrome loads the Studio app's `/?render=1` page with the job's
project injected, the app's own `exportMp4Project` renders it (frames,
narration mix, burned captions), the page POSTs the MP4 back, and
FFmpeg finishes it (loudnorm to -16 LUFS when audio exists, faststart).

## API
- `POST /jobs` — header `x-render-key`; body `{project, width, height, captions}` → `{jobId, token}`
- `POST /jobs/:id/result` — header `x-render-token`; raw MP4 body (render page callback)
- `GET /jobs/:id` — key or token → `{state, error, sizeBytes}` (queued/rendering/processing/done/error)
- `GET /jobs/:id/file?token=` — the finished MP4
- `GET /health`

Caps: project ≤ 10 min, ≤ 1920×1080, one job at a time, job files
swept after 2 hours. Premium (Google) voices need a signed-in session
the render browser does not have, so jobs narrate with basic voices;
a premium-voiced project fails the job with that error, never a
silent voice swap.

## Deploy (VPS, Ubuntu 24.04)
1. Install: `ffmpeg`, `caddy`, Google Chrome stable .deb, Node 22 at /opt/node22.
2. Copy this directory to `/opt/finch-render`, `npm install --omit=dev`.
3. `/opt/finch-render/render.env` with `RENDER_KEY=<random>` (600 perms).
   The same value goes into the editor build as `VITE_RENDER_KEY`
   alongside `VITE_RENDER_URL=https://render.finchlearn.com`.
4. `finch-render.service` → `/etc/systemd/system/`, enable + start.
5. `Caddyfile` → `/etc/caddy/Caddyfile`, reload caddy. DNS:
   `render.finchlearn.com` A → the VPS, DNS-only (Caddy terminates TLS).
