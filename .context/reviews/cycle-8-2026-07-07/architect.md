# Architect review — cycle 8 (2026-07-07)

Scope: architectural/design risk sweep of GalleryKit at HEAD `6256a988`. Read-only —
no source files modified, only this review file written.

## Method

1. Read `.context/plans/deferred-carry-forward.md` (the consolidated open-findings
   register) and the CLAUDE.md architecture sections to build a baseline of
   already-accepted/known risks, so this pass focuses on NEW structural risk or
   evidence that a known risk has materially changed.
2. Built a module inventory: `app/[locale]` (routed pages) / `app/actions` (mutating
   server actions, origin-gated) / `app/api` (routes, `withAdminAuth`-gated for
   `api/admin/**`) / `lib` (business logic + process-local state) / `db` (schema +
   pool) / `components`.
3. Read `instrumentation.ts`, `lib/maintenance-scheduler.ts`, `lib/image-queue.ts`
   (full, ~1315 lines), `lib/storage/{index,types}.ts`, `lib/data.ts` (structure +
   exports), `lib/advisory-locks.ts`, `lib/single-writer-guard.ts`,
   `lib/gallery-config.ts`, `lib/smart-collections.ts`, and
   `app/api/admin/lr/upload/route.ts` in full, cross-referenced against git history
   for the same files.
4. Cross-checked candidate findings against the last ~8 cycles' architect reviews
   and the deferred register before writing anything up, to avoid repeats.

## Inventory notes (for context, not findings)

- **`instrumentation.ts`** is now a clean composition root: it imports
  `maintenance-scheduler.ts`, `image-queue.ts`, `single-writer-guard.ts`, and
  `restore-maintenance-durable.ts` as independent modules and only sequences their
  boot/shutdown. This confirms **C4-17 is already resolved** — the deferred
  register still lists it as "SCHEDULED-NEXT (cycle 5)" but `git log --follow` on
  `lib/maintenance-scheduler.ts` shows it was extracted in `d4bccea2` (cycle 5) and
  instrumentation.ts wires it directly, not through `image-queue.ts`. Recommend the
  next deferred-register pass drop C4-17 from "open" bookkeeping (harmless if
  missed — it's a doc-lag, not a code risk).
- **Advisory-lock scope** (`lib/advisory-locks.ts`, `lib/single-writer-guard.ts`)
  is internally consistent: every serialization lock is deliberately MySQL-SERVER-
  scoped (documented, single sentence of truth in one file), and the one
  DB-scoped exception (`getSingleWriterLockName`, hashed per `DB_NAME`) is
  explicitly called out as the deliberate exception with its own reasoning. The
  single-writer guard itself (keepalive, lapse detection, re-probe/re-acquire,
  stop-latch) is unusually well hardened for a warn-only diagnostic — no new risk
  found here.
- **Config layering** (`gallery-config-shared.ts` → `gallery-config.ts` →
  consumers): confirmed the two accessors (`getGalleryConfig()`, React
  `cache()`-deduped, for request paths; `getGalleryConfigDetached()`, TTL-microcached,
  for background/detached contexts) are used at the correct call sites — every
  `app/[locale]/**/page.tsx`, `app/api/**/route.ts`, and `app/feed.xml` consumer uses
  the request-cached form; `image-queue.ts` and `admin-backfill-runner.ts` (the only
  detached-context callers) use the detached form. No new drift found (this was a
  real bug class before, C4-07 — it stays fixed).
- **`lib/smart-collections.ts`** (AST compiler for the unwired Collections feature)
  is a good architectural example: pure function, allowlisted columns, depth/size
  budgets, parameterized SQL, discriminated-union AST with a separate
  parse-time validator. No concerns.

## Findings

### ARCH8-01 — The Lightroom/PAT upload route is a hand-mirrored duplicate of the browser upload action, with a proven history of drift between the two

- **Severity:** MED. **Confidence:** High.
- **Citations:** `apps/web/src/app/api/admin/lr/upload/route.ts` (full file, 612
  lines) vs `apps/web/src/app/actions/images.ts` `uploadImages()` (lines 129-655).

There are two independent, hand-synchronized implementations of "accept an
uploaded file and turn it into a processed image row": the server action
`uploadImages()` (browser multipart form) and the route handler in
`lr/upload/route.ts` (PAT-authenticated external publish clients). They share only
the *low-level* primitives (`saveOriginalAndGetMetadata`, `extractExifForDb`,
`stripGpsFromOriginal`, `enqueueImageProcessing`, `createProcessingSettingsSnapshot`),
but each re-implements the entire *orchestration* independently: validation order,
upload-quota tracking, restore-window re-checks (there are three separate
restore-maintenance checks staged through the LR route alone), the upload-processing
contract lock acquire/release, the 1 GiB disk-space preflight, the `allow_hdr_ingest`
gate, the GPS-strip-then-verify step, the DB insert, and the post-commit
enqueue+audit+revalidate sequence.

The LR route's own comments document this as intentional ("mirroring the browser
path", "mirroring app/actions/images.ts") at more than a dozen separate call
sites — the two paths are meant to stay byte-for-byt behaviorally identical, but
there is no shared function or type that enforces that; only code-review
discipline does.

This is not a hypothetical risk — it already happened twice, per the code's own
inline history:

- `CR-R9C6-01` (run-9 cycle 6, confirmed by three independent review agents):
  the browser upload path silently omitted 6 admin-configurable processing
  settings (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`,
  `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`) from the
  enqueued job, so every fresh upload silently used Sharp defaults instead of
  the admin's configured values whenever any of those 6 settings had been
  changed from default.
- The fix for `CR-R9C6-01` landed on the browser path only. The LR route's own
  comment at `lr/upload/route.ts:538-547` (`CR-R9C7-01`) records that the fix
  "missed on this parallel enqueue site" — the LR/PAT path kept using Sharp
  defaults for the same 6 settings for a further cycle, because there was no
  single code path whose fix would have covered both.

Both instances are now fixed (both routes carry the full settings snapshot
today), so this is not a live bug. The architectural point is that the
underlying cause — two parallel orchestrations kept in sync by comment-driven
discipline rather than a shared function — is untouched, and the same class of
drift (a new admin-tunable field, a new restore-window edge case, a new
validation rule) will recur on the next feature that touches upload unless one
path is fixed. `grep` confirms these are the *only* two code paths that
`INSERT`/`UPDATE` the `images` table's upload row (no other API route mutates
`images` directly), so the blast radius of consolidating is bounded and
well-understood.

**Suggested refactor:** extract a single `ingestUploadedImage(...)` (or similar)
orchestration function parameterized over the few genuine differences (auth/actor
resolution, request-body-size preflight shape, response format — JSON API vs
server-action return value) that both the server action and the route call. This
does not need to happen in one sweep; per the project's own incremental-drainage
policy (C1-32), the next upload-flow-touching cycle is the natural point to fold
this, same treatment as C4-16 for image-queue state.

### ARCH8-02 — `quiesceImageProcessingQueueForRestore` resets `embeddingScanCursorId` but not its paired `embeddingScanModelVersion`, reinforcing C4-16's thesis with a concrete instance

- **Severity:** LOW (currently latent, not a live bug). **Confidence:** High.
- **Citations:** `apps/web/src/lib/image-queue.ts:357-366` (field definitions),
  `:547-553` (the guard that reads both fields together),
  `:1290-1297` (the restore-quiesce reset, which touches one but not the other).

`ProcessingQueueState` carries `embeddingScanCursorId` (resume point for the
missing-embedding scan) and `embeddingScanModelVersion` (the model version the
cursor was last advanced under) as a **paired** pair of fields — see the guard in
`bootstrapMissingActiveEmbeddings`:

```ts
if (state.embeddingScanModelVersion !== activeModelVersion) {
    ...
    state.embeddingScanCursorId = 0;
    state.embeddingScanModelVersion = activeModelVersion;
}
```

`quiesceImageProcessingQueueForRestore` — the reset path that runs when a DB
restore is about to replace the `images`/`image_embeddings` tables wholesale —
explicitly zeroes `embeddingScanCursorId` (with a comment citing C3-07/C3-20 for
exactly this reason: the restore may replace the images table entirely) but never
touches `embeddingScanModelVersion`. Today this is harmless: because the cursor is
already reset to 0 by the explicit line, the mismatch guard's own cursor-reset
becomes a no-op even in the case it fires, and if the version matches by
coincidence the guard doesn't fire at all — so there is no reachable state where
this produces a wrong scan result right now.

But it is precisely the failure shape the project's own C4-16 finding predicts:
`ProcessingQueueState`'s lifecycle is reset by hand at (at least) three call
sites — the initial-construction literal, the defensive re-init backfill in
`getProcessingQueueState()` (lines 396-409), and `quiesceImageProcessingQueueForRestore`
— and each site has to independently remember every field that has been added
since the last time someone touched all three. This instance is a near-miss (the
guard's self-correcting design absorbed the gap); the next field added to the
struct may not be so forgiving. Recommend folding this into the same pass that
resolves C4-16 (the deferred register already schedules that on "next
image-queue-touching cycle" or "a 5th lifecycle-reset bug lands" — this is
arguably that signal firing, just caught before it became an observable bug).
**Minimal fix, if taken standalone:** add `state.embeddingScanModelVersion = null;`
next to the existing `state.embeddingScanCursorId = 0;` in the restore-quiesce
reset.

## Confirmed-unchanged (no new finding — logged for due-diligence, not double-counted)

- **`lib/data.ts`** (1897 lines, up from 1860 at C3-36's citation) still mixes
  the shared-group view-count write-buffer subsystem (its own retry/backoff/
  eviction state machine, ~200 lines) with the bulk of the app's read-query
  surface and SEO-settings resolution. This is exactly what C3-36 already
  describes; growth since is incremental (~37 lines), not a step change. No new
  finding filed — governed by the existing C1-32 incremental-drainage policy.
- **`lib/storage/*`** remains a zero-external-consumer internal abstraction
  (`grep` for `getStorage`/`switchStorageBackend`/`StorageBackend` outside
  `lib/storage/` and tests returns nothing). Matches C2-27 exactly; still an
  open product decision, not a new architectural risk.
- **`lib/image-queue.ts`** (1315 lines) continues to accumulate bootstrap +
  processing + embedding-scan-cursor + restore-quiesce concerns in one module
  (two more fields — `embeddingScanCursorId`, `embeddingScanModelVersion` —
  landed since C4-16 was filed, per `git log` on `200a74bf` and `d7ca37de`).
  This is the trend C4-16 already flags; ARCH8-02 above is a concrete symptom
  of it, not a separate root cause.
- **Detached vs. request-cached gallery config** (C6-24, the two-cache-
  mechanisms-for-one-config concern) is unchanged; call-site usage is correct
  today (see inventory notes above), so the risk is exactly as previously
  characterized: latent duplication, not a live staleness bug.

## Final sweep for commonly-missed design risks

- Checked for circular imports between `lib/image-queue.ts` and `lib/data.ts`:
  none (neither imports the other).
- Checked for other API routes writing to `images` directly outside the two
  upload paths covered by ARCH8-01: none found (`grep` for
  `db.insert(images)|db.update(images)` under `app/api/` returns only the LR
  upload route; all other image mutation lives in `app/actions/images.ts`).
- Checked the newest process-local state addition,
  `lib/pending-session-revocations.ts` (added for the restore-window logout fix,
  commit `c882e82d`): it is bounded (256-entry cap, FIFO eviction), documents its
  own process-local residual risk inline, and was landed via an explicit
  "5-lane agreement" per its own comment — already reviewed, not a new gap.
- Checked `db-child-watchdog.ts` (extracted from `db-actions.ts` in `f201309c`,
  this cycle's most recent architecturally-relevant commit): a clean, positive
  extraction — moves a testable sync helper out of a `'use server'` file that
  can only export async actions. No concern.

## Summary

Total findings by severity: 0 CRIT, 0 HIGH, 1 MED, 1 LOW.
