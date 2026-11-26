# finch-generate: Studio AI generation service (issue #361)

The server-side core for in-app AI generation in FinchLearn Studio. The
character flow (#362) and the asset flow (#363) both call this one
service; it composes the model prompt from the caller's intent, calls
the Gemini image API, and meters the result against the existing
FinchLearn plan allowance. There is no second credit system.

## API

Mounted at `https://render.finchlearn.com/generate` (a location block
on the existing render vhost; see nginx-generate.conf).

- `GET /generate` (or `/generate/health`) — `{ ok, configured,
  geminiConfigured, meteringConfigured, model }`.
- `POST /generate` — headers `x-finch-ai-key` (the shared app key, same
  trust class as the render and ingest keys) and `Authorization: Bearer
  <user Supabase JWT>`. Body (the ai-assets endpoint contract):
  `{ prompt, userPrompt, kind, styleFamily, styleTag, styleGuidance,
  look, background, width, height, allowanceScope, idempotencyKey }`
  with kind one of `character | prop | object | background`. Returns
  `{ remoteUrl, width, height, model, quota }`.
- `GET /generate/assets/<file>` — a stored generated image (public,
  `access-control-allow-origin: *`, immutable caching).

Errors are JSON `{ error, code, ... }`:

- `401 unauthorized` — bad app key or bad/absent user token.
- `400 bad_request` — missing kind, description, or idempotency key.
- `402 allowance_exhausted` — the plan's monthly content generation
  allowance is used up. Carries the quota position and `resetsAt`;
  the message names the allowance, the reset date, and the upgrade /
  add-on pack path. A denied request NEVER reaches the model (the
  journal logs `GEMINI_CALL` before every model call and `GEN_DENIED`
  for denials, so this is provable from the log).
- `503 generation_not_configured` — no Gemini key in the service env.
  This is the honest unconfigured state: the service runs, health
  reports it, and nothing is generated or counted.
- `503 metering_unavailable` — the allowance meter cannot be reached
  or is not provisioned; generation fails closed rather than running
  unmetered.
- `502 generation_failed` — model error, timeout, or output that is
  not a usable image. Failed generations are never charged.

## Metering

Mirrors the ai-generate edge function (the existing cloud meter path)
for the `images_generated` unit:

- Plan resolves via `effective_plan_level`. Plan defaults (decided
  Oct 28, 2026): community 0, keeper 10, creator 40, studio 100
  content generations per month; in the plan-default path the content
  counter is ONE allowance enforced against `blocks_generated` +
  `images_generated` rows summed for the current UTC month.
- Without a plan default, the `ai_entitlements` row's
  `images_allowance` applies; without either, `GEN_DEV_ALLOWANCE`
  (default 0) applies, so an unresolvable user is denied, never
  granted.
- Promo topups ride the same path: `promo_topup_balance` adds the
  monthly boost and the one-time pool (fail soft), and a generation
  funded past the boosted allowance draws the pool via
  `promo_consume_topup` after the ledger write.
- The charge is one `ai_usage` row (`unit = images_generated`)
  written once, on a validated success only, idempotent on the
  caller's `idempotencyKey` (unique on user + unit + key). A repeat
  call with the same key continues the already-metered generation
  and does not charge again.

## Configuration (host env only)

`/opt/finch-generate/generate.env` (root, 600), read via the systemd
unit's EnvironmentFile:

- `GEN_APP_KEY` (required) — the shared app key the editor build
  carries as `VITE_FINCH_AI_ASSET_API_KEY`.
- `GEMINI_API_KEY` — the Gemini product key. ABSENT in the shipped
  state until Justin makes the product key decision; the service
  fails closed and reports unconfigured without it. Never put this
  key in the client bundle, a VITE_ variable, or this repo.
- `GEMINI_IMAGE_MODEL` — default `gemini-3.1-flash-image` (the same
  default the ai-generate edge function uses); swap without a client
  release.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — the meter path
  (service role, server-side only, same as the edge functions).
- `GEN_DEV_ALLOWANCE` — default 0.

Generated images are stored on the host under
`/var/lib/finch-generate/assets` and served by the service itself.
Follow-up before heavy product use: move storage to R2 behind the
media worker (the provider contract already accepts an `r2Key`
alongside `remoteUrl`) and add a retention sweep for the local store.

## Deploy

1. Copy `server.mjs` + `package.json` to `/opt/finch-generate/`
   (no dependencies to install).
2. Write `/opt/finch-generate/generate.env` (600, root).
3. `mkdir -p /var/lib/finch-generate/assets`.
4. Install `finch-generate.service` to `/etc/systemd/system/`,
   `systemctl daemon-reload && systemctl enable --now finch-generate`.
5. Add the `/generate` location from nginx-generate.conf to the
   render vhost, `nginx -t && systemctl reload nginx`.
6. Verify: `curl https://render.finchlearn.com/generate` returns the
   health JSON; with no `GEMINI_API_KEY` set, a well-formed POST
   returns `503 generation_not_configured`.
