# Run-4 Cycle 2 — perf-reviewer + architect + document-specialist + designer angle

## perf-reviewer

- **Image-serving path:** last cycle's serve-upload import swap (748b5d7a) holds — no
  sharp graph on the serving path; ETag settings-hash composition unchanged.
- **Hot queries:** `tagNamesAgg` GROUP_CONCAT shape intact across the four list queries;
  analytics queries all ride their composite `(id, viewed_at)` indexes;
  `orderBy(desc(sql\`viewCount\`))` is a constant alias (no injection, no filesort
  surprise beyond the inherent GROUP BY).
- **View-count buffer:** chunked flush with backoff verified again; timers `unref()`ed.
- **No new perf findings.** The doomed-INSERT cost in COR-R4C2-07 (recordTopicView FK
  rejects) is bounded by the 120/min/IP limiter — filed as correctness-parity, not perf.

## architect

### ARCH-R4C2-06 — duplicate 200 MiB per-file constants (enforcement vs UI hint) (LOW / High)
- `lib/process-image.ts:332` `const MAX_FILE_SIZE = 200 * 1024 * 1024` (the ACTUAL
  enforcement inside `saveOriginalAndGetMetadata`, shared by browser + LR paths) vs
  `lib/upload-limits.ts:3` `export const MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024` (what
  the dashboard upload UI displays and pre-checks, and what sizes the Next server-action
  body cap derivation).
- **Failure scenario:** operator raises the limit by editing `upload-limits.ts` (the
  documented-looking, exported one); UI now advertises 300 MB while the encoder rejects
  at 200 MB with a 422 after the full multipart upload cost. Or vice versa.
- **Fix:** `process-image.ts` imports `MAX_UPLOAD_FILE_BYTES` (upload-limits has no
  heavyweight deps — env reads only — so no layering concern) and drops the local
  constant. Behavior identical today; drift becomes impossible.
- Confidence: High.

- **Advisory-lock namespace, queue topology, single-writer constraints:** re-checked
  against CLAUDE.md "Runtime topology" — consistent.
- **`getRequestWithHeaders` body-drop in proxy.ts:** benign — middleware result only
  routes; bodies are consumed by the route handler from the original stream. Pattern
  long-standing; no action.

## document-specialist

- **Gates docs current:** CLAUDE.md "Lint Gates" + AGENTS.md quality-gates both list all
  4 scanners including `lint:public-route-rate-limit` (fixed last cycle, 8950a82d).
- **Upload caps:** CLAUDE.md "200 MB per file / 2 GiB window / 100 files" matches
  `upload-limits.ts` + `process-image.ts:332` (same value today — see ARCH-R4C2-06 for
  the duplication risk).
- **`IMAGE_PIPELINE_VERSION = 7`** matches `gallery-config-shared.ts:21` and the
  CLAUDE.md table.
- **Backfill / migration runbooks:** spot-checked against migrate.js post-80a808e9 —
  the runbook's step-3 reconcile contract now also matches the fresh-DB path. The
  `migrate-reconcile-coverage.test.ts` tripwire enforces it forward.
- **DOC observation (folded into UX-R4C2-03 fix):** CLAUDE.md documents the failed-image
  admin surface implicitly via R10-H2 lineage in code comments only; no doc change
  needed once the surface actually works.
- No standalone doc/code mismatch findings this cycle.

## designer (UI/UX)

UI presence: Next.js web frontend (App Router) — designer review applies. This cycle's
designer pass focused on the admin surfaces touched by recent work (tokens page,
dashboard failed-images panel) plus a text-evidence re-audit of the photo-viewer z-stack
fixed last cycle (no browser run this cycle; the panel under review is currently
unreachable in ANY environment because of COR-R4C2-01, making DOM-snapshot evidence
impossible — source-level evidence cited instead).

### UX-R4C2-03 — failed-images panel thumbnails request derivatives that failed images typically don't have (MED / Medium)
- **File:** `app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:78-84`
  ```tsx
  <img src={sizedImageUrl('/uploads/jpeg', img.filename_jpeg, 64, imageSizes)} … loading="lazy" />
  ```
- **Why it is a problem:** an image lands in this panel precisely BECAUSE processing
  failed — in the dominant failure class (decode/encode error) the `_64.jpg` derivative
  was never written, so every row paints a broken-image glyph (no `onError` fallback),
  undermining the panel's job of letting the admin recognize which photo to retry. It is
  also the repo's ONLY `@next/next/no-img-element` warning.
- **Interaction with COR-R4C2-01:** the panel is unreachable today (failed rows never
  persist). Fixing -01 makes this panel live for the first time — shipping it with
  broken thumbnails would be a poor first impression of the feature.
- **Fix:** replace the `<img>` with a deterministic icon tile (lucide `ImageOff`, same
  44 px square, `aria-hidden` + retained text identification via title/user_filename) —
  honest about the file state, zero doomed HTTP fetches, and clears the eslint warning at
  the root (no suppression).
- Confidence: Medium severity (admin-only, currently-dead surface) / High that the
  defect is real.

### Designer observations (recorded, not scheduled)
- **Tokens page scope minimization:** `tokens-client.tsx:52` always requests all three
  scopes (`lr:upload, lr:read, lr:delete`) with no UI choice. Least-privilege would
  default to `lr:upload` for the Lightroom publish use case. Product-level decision —
  recorded as deferred with exit criterion (see deferred ledger).
- Tokens page touch targets, aria-labels, dialog focus flow re-checked: compliant
  (h-11/min-h-[44px] throughout, per the touch-target audit fixture).
