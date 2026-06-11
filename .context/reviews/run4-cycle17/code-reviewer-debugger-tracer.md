# Code-reviewer + debugger + tracer — Run-4 Cycle 17

Single-subagent in-context pass (documented run-wide constraint: nested
Agent spawning unavailable). Full-inventory, no sampling.

## Inventory covered this pass

1. **Line-level regression review of all six cycle-16 fix commits**:
   `7144479c` (settle-before-close × 6 dialogs), `61d85a05` (CSP GA4),
   `61218056` (IMAGE_BASE_URL dataset), `e0f7f684` (44 px select +
   audit), `233c38b2` (live regions), `217098aa` (anchored zoom).
2. **Rotation to zero/low-run-4-coverage surfaces** (mention-count map
   over run4-c1..c16 review texts): OG/SEO cluster (`api/og/route.tsx`,
   `api/og/photo/[id]/route.tsx`, `lib/og-photo-fetch.ts`,
   `lib/photo-title.ts`, `lib/safe-json-ld.ts`, `app/robots.ts`),
   restore/maintenance cluster (`lib/db-restore.ts`,
   `lib/restore-maintenance.ts`, `lib/advisory-locks.ts`,
   `lib/queue-shutdown.ts`, `lib/mysql-datetime.ts`), platform libs
   (`lib/request-origin.ts`, `lib/sanitize.ts`, `lib/gallery-config.ts`,
   `lib/auth-rate-limit.ts`, `lib/caption-generator.ts`,
   `lib/clip-embeddings.ts`, `lib/clipboard.ts`, `lib/utils.ts`,
   `lib/hdr-filenames.ts`, `lib/bulk-edit-types.ts`), admin clients
   second half (`analytics-client.tsx`, `dashboard-client.tsx`,
   `password-client.tsx`, `password-form.tsx`, `seo-client.tsx`),
   shared components (`tag-input.tsx`, `optimistic-image.tsx`,
   `topic-empty-state.tsx`, `map/map-loader.tsx`), actions (`tags.ts`,
   `seo.ts`, `admin-backfill.ts`), runtime glue (`db/index.ts`,
   `i18n/request.ts`, `instrumentation.ts`), ui-primitives sub-44 +
   suppression sweep.

## Regression review of cycle-16 commits — SOUND

- `7144479c` — all six call sites verified against the DES-R4C14-B
  shape. `image-manager.tsx` handlers manage `deletingId` /
  `isBulkDeleting` in `finally` (lines 137-188); dialogs close
  post-settle on success AND failure (failure communicated via toast,
  consistent with tag-manager). `onOpenChange` guards are inert only
  mid-flight. `sales-client.tsx` comment claim "handleRefund's finally
  clears refundingId AND confirmTarget" VERIFIED true at lines 155-156.
  `admin-user-manager.tsx` dismiss correctly moved post-await.
  `db/page.tsx` marker placement correct. No follow-on.
- `61d85a05` — wildcard host sources are valid CSP; img/connect/script
  tiers match the documented analytics-only contract; GA-absent CSP
  byte-identical (locked by test). No follow-on.
- `61218056` — lazy `resolveImageBase()` correctly reads
  `document.documentElement.dataset.imageBase` browser-side and the env
  constant server-side; `data-image-base` omitted when unset; no
  consumer of `imageUrl` renders outside the locale layout (OG/feed
  consumers are server-side). No follow-on.
- `e0f7f684`, `233c38b2` — mechanically correct; audit extension
  verified failing-then-passing per commit body. No follow-on.
- `217098aa` — `anchorPctFromClientPoint` + `anchoredZoomPosition` are
  verbatim extractions (compared against pre-image arithmetic);
  `zoomInAt` guards zero-dimension rects; `changedTouches[0]` is always
  present on touchend; keyboard path keeps center zoom. Pinch passivity
  untouched (DEF-R4C8-C intact). No follow-on.

## Findings

### COR-R4C17-05 — `batchUpdateImageTags` silently drops control-char-rejected tag names while format-invalid names warn
- **File:** `apps/web/src/app/actions/tags.ts:397-408` (add loop) and
  `:423-428` (remove loop).
- **Severity/Confidence:** LOW / Medium. CONFIRMED behavior.
- **Problem:** in the add loop, a name that fails `isValidTagName`
  pushes `warnings.push(t('invalidTagName') + ": \"" + cleanName + "\"")`,
  but a name rejected by `requireCleanInput` (control chars / bidi /
  zero-width) hits `continue` with NO warning. Same asymmetry in the
  remove loop. The caller gets `success: true, added: N` with some
  requested names silently ignored — an inconsistent partial-success
  surface within the SAME loop.
- **Failure scenario:** admin pastes a tag list from a PDF that carries
  a zero-width space in one name; bulk edit reports success; the tag is
  never attached; no signal anywhere.
- **Fix:** push the same `invalidTagName` warning on the
  `nameRejected` path (do NOT echo the dirty value — `value` is null on
  rejection by design; warn with the generic key only).

### Cross-checked non-findings (traced, clean)
- `tag-input.tsx` ArrowUp/Down `maxIndex` math: `-1` case (empty list,
  no create option) degenerates safely to index 0 with no
  active-descendant emitted. IME guard (COR-R4C6-01) intact.
- `optimistic-image.tsx` retry ladder: ref+state pairing is coherent
  across re-renders; cleanup clears the timer; `/uploads/` 1-retry cap
  honors the encoder atomic-rename contract.
- `db/index.ts` `group_concat_max_len` init promise plumbing (C8-F01
  symbol hop) verified: event handler attaches to the callback
  connection, `getConnection` reads through `.connection`. Correct.
- `instrumentation.ts` graceful shutdown: 15 s race + `process.once` —
  no double-handler, no leak.
- `seo-client.tsx` dirty-diff + post-save rehydrate from
  `result.settings` (only changed keys echoed) — `initialRef` update is
  consistent; no lost-field bug.
- `gallery-config.ts` per-key validation fallbacks: every getter
  re-validates and falls back to defaults; catch path returns a fully
  validated default object.
- `analytics-client.tsx` locale-agnostic `/p/` + `/g/` hrefs rely on
  middleware locale redirect — one extra hop, intentional (documented
  for `/g/`), not a defect.

## Commonly-missed-issues sweep
- No new `setTimeout`/listener leaks in c16-touched files.
- No shared-state hazards introduced by the controlled-dialog
  conversions (state is per-component, single-writer).
- ui-primitives sweep: only `table.tsx:73` `h-10` (non-interactive
  header cell — out of policy scope); single documented
  `eslint-disable-next-line @typescript-eslint/no-require-imports` in
  `lib/analytics.ts:39` (load-bearing, commented).
- `formatBinarySize` labels powers of 1024 as "GB"/"MB" (binary sizes
  with SI labels) — display-only nit on an admin limit string;
  changing to GiB/MiB would touch i18n for zero user value. Not filed.
