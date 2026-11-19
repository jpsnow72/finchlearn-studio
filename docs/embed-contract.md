# FinchLearn embed contract (issues #9 and #49)

The contract between FinchLearn (open-course-format #629) and FinchLearn
Studio for embedding Studio in a course video block. It follows the Canva
handoff pattern already shipped in FinchLearn: a signed, short lived
handoff one way, a structured return payload the other way, and an
edit-again flow keyed to a durable project binding. Implemented on the
Studio side in `apps/editor/src/embed.ts`; the shell resolution lives in
`apps/editor/src/shell.tsx` and the Finish flow in
`apps/editor/src/components/TopBar.tsx`.

## Opening Studio from a course block

FinchLearn opens a popup (or embedded surface) at:

```
https://studio.finchlearn.com/?embed=finchlearn&handoff=<token>
```

The handoff token is an HS256 compact JWS (JWT shape):

```
base64url(header) "." base64url(payload) "." base64url(signature)
header    = { "alg": "HS256", "typ": "JWT" }
signature = HMAC-SHA256(signing input, shared secret)
```

A two part form (`base64url(payload) "." base64url(signature)`) is also
accepted by the Studio verifier so the sides can reconcile without a
flag day. The shared secret is build config on the Studio side
(`VITE_STUDIO_HANDOFF_SECRET`), the same trust class as the render and
narration app keys already in this bundle.

Payload claims (JSON, camelCase):

| Claim | Meaning |
| --- | --- |
| `v` | Contract version, `1` |
| `iss` | `"finchlearn"` |
| `aud` | `"finchlearn-studio"` |
| `sub` | FinchLearn user id (`userId` accepted as an alias) |
| `courseId` | Course containing the block |
| `blockId` | The video block the project binds to |
| `mode` | `"create"` or `"edit"` |
| `projectId` | Bound Studio project id; required in edit mode |
| `returnOrigin` | Bare origin Finish payloads are posted to |
| `returnUrl` | Optional deep link back to the course (display only) |
| `iat`, `exp` | Issued at / expiry, seconds since epoch |
| `nonce` | Single open id (double-open guard) |

Verification fails closed. Studio rejects, and opens nothing for: a
malformed token, a bad signature, an unsupported version, issuer, or
audience, a missing required claim, an expired token, a token issued in
the future, a lifetime over 30 minutes, and any handoff when no secret
is configured in the build. Minting guidance: 10 minute lifetime. The
legacy local bridge (`?embed=<objectId>` with a project stashed in
localStorage by the old in-course editor) is unchanged; the
`?embed=finchlearn` surface without a valid handoff is rejected.

Modes:

- Create: Studio starts a fresh project bound to the block. The first
  Finish payload carries its project id, which becomes the binding.
- Edit: Studio reopens the bound project (the `studio_projects` cloud
  copy first, the local copy as fallback). Edit again from the block
  mints a fresh handoff with the same project id.

The editor chrome in embed mode: the primary action becomes "Save and
Return to Course" (Finish); the standalone Export dialog stays available
as a secondary action.

## Finish: the return payload

On Finish, Studio posts this payload to `window.opener` with
`postMessage` at exactly the handoff's `returnOrigin` (never `"*"`),
and also persists it in the popup's localStorage under
`ocf.video-studio.return.<blockId>` so the course editor can pick it up
even if the popup closes first.

```json
{
  "type": "finchlearn-studio:finish",
  "version": 1,
  "courseId": "course id",
  "blockId": "video block id",
  "mode": "create | edit",
  "projectId": "studio project id",
  "renderState": "ready | rendering",
  "exportId": "studio_exports row id, or null while rendering",
  "assetId": "media library asset id, or null while rendering",
  "objectKey": "R2 object key, or null while rendering",
  "mp4Url": "MP4 URL, or null while rendering",
  "posterUrl": "poster image URL, or null",
  "durationMs": 12345,
  "captions": [{ "format": "vtt | srt", "url": null, "content": "file text" }],
  "captionFiles": "alias of captions, same array"
}
```

Field notes:

- `assetId` is the `studio_exports` row id (the same value as
  `exportId`): the durable handle for the saved render. `objectKey` is
  its R2 key in the finch-exports bucket, under `s/<userId>/`.
- `mp4Url` is the finch-media Worker download URL returned when the
  export was saved. It plays signed in or out (media identity
  independence): nothing in the payload depends on the viewer's session.
- `durationMs` is milliseconds; the course side converts to OCF timing
  seconds at its boundary.
- `captions` carries VTT and SRT files built from the project's
  dialogue, with the full file text inline (`url` is null until a
  hosted caption file exists). `captionFiles` is the same array under
  the alternate name, carried so either reading reconciles.
- `posterUrl` is null today: Studio has no poster generation yet, and
  the field is carried so the course block can fill it in later without
  a contract change.

## Render still running

Finish always returns twice when the render is not done yet:

1. Immediately, a payload with `renderState: "rendering"` and the asset
   fields null. The block binds the project id and shows the render
   state. The payload is also kept under
   `finch-studio.embed-pending.<blockId>`.
2. When the render lands and the file is saved to the media library, a
   second payload with `renderState: "ready"` and the asset fields
   filled in, delivered on the same channels.

If the render fails, no ready payload follows and the block keeps the
rendering state with the project binding intact; the project itself is
never lost (local autosave plus the `studio_projects` cloud sync), and
pressing Save and Return again retries from the same project.

A cancel message (`{ "type": "finchlearn-studio:cancel", "version": 1,
"courseId": ..., "blockId": ... }`) is reserved for a later pass; this
build does not send it, and closing the popup without Finish changes
nothing in the course.
