# Code review — Run-3 Cycle 2 (HEAD 2feba5ae)

## F1 — LR upload path diverges from browser path on GPS-original stripping (HIGH)

Agrees with security-reviewer F1. The cycle-1 fix ported the HDR gate but the
two ingest paths still diverge on the GPS-on-disk strip. Root cause is the
known anti-pattern the R8 plan called out: two parallel insert paths with no
shared `buildInsertValues(data, config)` + `applyIngestPolicy(data, config)`
helper. Each new admin-gated constraint must be remembered in two places, and
this one was missed.

`apps/web/src/app/api/admin/lr/upload/route.ts:131-135` nulls only the DB
columns; the browser path (`app/actions/images.ts:318-324`) additionally calls
`stripGpsFromOriginal()` on the saved file. Minimal-fix: add the same call in
the LR route. Architectural follow-up (NOT this cycle): extract the shared
policy helper so divergence #3 cannot happen.

## Other observations (no new action)

- `lr/upload/route.ts` correctly imports `deleteOriginalUploadFile` (cycle-1)
  and would reuse it for any GPS-strip failure cleanup — but GPS strip is
  best-effort and must NOT delete the upload on failure (parity with browser:
  the browser path logs and continues, keeping the image). Implement the LR fix
  the same way: call `stripGpsFromOriginal`, never abort the upload on its
  failure.
- `enqueueImageProcessing` payload parity between the two paths is otherwise
  good (both forward `colorSignals`, `iccProfileName`, quality, sizes).
- i18n EN/KO parity verified clean (812/812 keys, no orphans either direction).
- `serve-upload.ts` ETag includes pipeline version + mtime + size + color
  settings hash; correct and unchanged.

## Confidence
F1 HIGH/High — same evidence chain as security-reviewer, independently traced.
