# Architecture & Design-Risk Review — Run-8 Cycle-2

**Date:** 2026-06-13
**Reviewer:** architect (architecture & design risk — coupling, layering, abstractions, module boundaries, state-coordination correctness, scalability assumptions, single-points-of-failure, error-handling architecture)
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6, MySQL+Drizzle, single-web-instance / single-writer Docker topology)
**HEAD:** `77867144` (working tree CLEAN — verified `git diff HEAD` empty; the `M`-marked files in the session snapshot are identical to HEAD, all prior plan work is committed)
**Scope note:** A separate perf-reviewer covers raw performance. This review is architecture/design risk only.

---

## Prior arch items — re-confirmed as record-only (no re-report)

The run-7 aggregate's architecture observations are **inherent single-pool / single-writer tradeoffs**, explicitly documented in CLAUDE.md (restore flags, upload quota, image queue, view-count buffer are process-local; do not horizontally scale without moving coordination state to a shared store). Re-confirmed record-only at this HEAD:

- **AGG-R7-A1** — the AGG-5 connection reserve protects exactly one concurrent `getImage` fan-out; 2+ simultaneous visitors during a backfill still queue. Sound mitigation, inherent single-pool tradeoff. Record-only.
- **AGG-R7-A2** — decode-once-per-format perf opportunity (perf-reviewer's lane). Record-only here.
- **AGG-R7-A3** — `getImage` prev/next range scans run 3 concurrent uncached connections per photo view under `revalidate=0`. Deliberate freshness choice. Record-only.
- **AGG-R7-A4** — backfill PQueue + live image-queue share libvips capacity with no shared CPU budget. Single-writer topology; backfill is operator-initiated. Record-only.

**Prior OPEN arch item now CLOSED at HEAD:** AGG-R7-01 (stale pool-budget formula in 3 doc/comment sites) is **FIXED**. All three sites now agree on `cap = max(1, floor((LIMIT − RESERVED − 1)/2))`, `RESERVED = max(3, ceil(LIMIT/2))` → cap = 2 at pool 10:
- `admin-backfill-runner.ts:33-37` (file-header docblock)
- `admin-backfill-runner.ts:105-142` (`resolveBackfillConcurrency` + `BACKFILL_RESERVED_LIVE_CONNECTIONS`)
- `db/index.ts:16-22` (pool comment)
The self-contradicting file is gone. No re-report.

---

## Module-boundary & coordination surfaces verified SOUND (no defect)

These were stressed this cycle and are architecturally clean — recorded so future cycles don't re-investigate:

1. **`@/lib/storage` abstraction is NOT leaking.** It is import-dead outside its own tree (`src/lib/storage/index.ts` + `src/__tests__/storage-local.test.ts` only; the live pipeline uses `upload-paths.ts` direct fs). `switchStorageBackend`/`getStorage`/`getStorageSync` are unreachable from any admin action, route, or component. Self-documented accurately as "not yet wired." Matches CLAUDE.md. The only `'local' -> 'local'` switch is dormant, not a foot-gun.
2. **Privacy data-access guard is structurally ROBUST, not fragile.** `publicSelectFields` is derived from `adminSelectFields` by destructure-omit (separate object reference), the `_PrivacySensitiveKeys` compile-time `Extract` guard (`data.ts:416-420`) catches a *known* sensitive key leaking into public, AND the **symmetric** runtime test (`privacy-fields.test.ts:83-90`) asserts `adminKeys − publicKeys === SENSITIVE_KEYS` exactly — so a new admin-only column added to `adminSelectFields` and forgotten in `publicSelectFields` fails the build/test loudly. The `getImagesForFeed` JOIN (`data.ts:781-793`) spreads `publicSelectFields` first and adds only the JOIN-derived `author_name` (admin *username*, the photographer's chosen display name — not the raw PII `uploaded_by` id), with the same contract honored in `data-timeline.ts`. This is one of the strongest patterns in the repo.
3. **No NEW second writer.** `view_count` has exactly ONE writer (`data.ts:108` flush). `pipeline_version` has exactly the four documented writers (upload `images.ts:358`, queue `image-queue.ts:369`, backfill `:501`, LR route `:382`). The Lightroom upload route (`api/admin/lr/upload/route.ts`) funnels through the *identical* coordination primitives as the browser path — same `acquireUploadProcessingContractLock` (`:159` acquire / `:404` insert / `:478-480` finally release), same `enqueueImageProcessing` + per-image claim lock, same restore-maintenance double-check, same GPS strip, same `uploaded_by` attribution, `processed: false` initial insert. It is textbook parity, not a divergent writer.
4. **Advisory-lock coordination is complete.** All three contract-mutating callers (`settings.ts:75`, `images.ts`, LR route `:159`) hold `LOCK_UPLOAD_PROCESSING_CONTRACT`. Backfill <-> live-queue serialize via the shared `getImageProcessingLockName` per-image claim (TRC-R5C2-01). DB-backed rate limiting (`incrementRateLimit` atomic upsert, `decrementRateLimit` transactional) is the source of truth; in-memory Maps are documented fast-path cache. Error contracts on public actions (`public.ts`) are consistent structured `{ status }` results with symmetric rollback, never throwing to the client.

---

## OPEN / NEW findings

Only one genuinely-new architectural-hygiene item surfaced this cycle. It is LOW severity (doc-completeness on a multi-tenant safety note) — the substantive architecture is in strong shape at this HEAD.

### ARCH-1 — `advisory-locks.ts` cross-tenant safety docblock omits the backfill lock (doc-completeness)

- **File:** `apps/web/src/lib/advisory-locks.ts:8-14`
- **Design risk:** The module-level "IMPORTANT (C8R-RPL-06 / AGG8R-05)" note enumerates which operations serialize cross-tenant when two GalleryKit instances share one MySQL server: *"restores, upload-contract changes, topic renames, admin-user deletes, and image-processing claims."* It **omits `gallerykit_color_pipeline_backfill`** (`LOCK_COLOR_PIPELINE_BACKFILL`, defined in the *same file* at `:43`). CLAUDE.md's mirror of this exact note (Advisory-lock scope note, C8R-RPL-06 / AGG8R-05) DOES list "backfill runs," so the canonical doc and the in-code authority now disagree on the lock inventory.
- **Concrete failure scenario:** An operator considering multi-tenant co-location reads the in-code note (the natural place to look, since it sits beside the lock constants), enumerates the serialization blast radius from that list, and concludes a backfill on tenant A won't touch tenant B. In reality a long-running color-pipeline backfill on tenant A holds `gallerykit_color_pipeline_backfill` server-wide, so tenant B's in-app "Re-encode existing photos" button returns `already_running` for the entire (potentially multi-hour) window with no shared-instance explanation. Same class of surprise the note exists to prevent — the omission silently under-states the documented cross-tenant coupling.
- **Suggested direction:** Add "color-pipeline backfill runs" to the enumerated list at `:13` so the in-code authority matches both CLAUDE.md and the actual `LOCK_*` constants in the file. One-line doc fix; no code change.
- **Confidence:** High (static, verified the omission against the constant at `:43` and CLAUDE.md).
- **Disposition:** True (minor) DEFECT — doc/maintainability. Not a runtime correctness bug; the lock itself works correctly (verified in `admin-backfill-runner.ts:284-314` + `image-queue` claim path).

---

## Separation: DEFECTS vs record-only

- **DEFECT (actionable):** ARCH-1 only — LOW, single-line doc-completeness fix.
- **Record-only (inherent single-writer/single-pool tradeoffs, documented):** AGG-R7-A1..A4 (carried from run-7), plus the feed `author_name` exposure (deliberate, documented) and the dormant `@/lib/storage` abstraction (accurately self-documented as unwired).

## Trade-offs (ARCH-1)

| Option | Pros | Cons |
|--------|------|------|
| A: add "backfill runs" to the docblock list (recommended) | In-code authority matches CLAUDE.md + the actual lock constants; operators see the full cross-tenant blast radius beside the constants | None material |
| B: leave as-is | Zero churn | In-code note silently under-states cross-tenant coupling; contradicts the canonical CLAUDE.md note it mirrors; a co-location operator can mis-scope the backfill serialization |

---

## References

- `apps/web/src/lib/advisory-locks.ts:8-14` — cross-tenant note enumerating serialized ops (omits backfill)
- `apps/web/src/lib/advisory-locks.ts:43` — `LOCK_COLOR_PIPELINE_BACKFILL` defined in the same file, absent from the note above
- `apps/web/src/lib/admin-backfill-runner.ts:33-37, 105-142` — AGG-R7-01 formula now correct (cap=2 at pool 10); confirms prior open item CLOSED
- `apps/web/src/db/index.ts:16-22` — pool-budget comment now agrees with the runner (AGG-R7-01 closed)
- `apps/web/src/lib/data.ts:208-420` — admin/public/map select-field derivation + dual privacy guards (sound, not fragile)
- `apps/web/src/__tests__/privacy-fields.test.ts:83-90` — symmetric privacy guard ties the hand-maintained lists to the actual field objects
- `apps/web/src/lib/data.ts:781-793` — `getImagesForFeed` JOIN surfaces only derived `author_name`, keeps raw `uploaded_by` admin-only
- `apps/web/src/lib/data.ts:108` — sole `view_count` writer (no second writer)
- `apps/web/src/app/api/admin/lr/upload/route.ts:159,382,404,478` — LR upload route holds the contract lock + uses the shared claim/queue path (parity, no divergent writer)
- `apps/web/src/lib/storage/index.ts` — abstraction import-dead outside its own tree (no leak)
- `apps/web/src/lib/rate-limit.ts:419-491` — DB-backed atomic upsert + transactional decrement (source of truth; in-memory Maps are documented cache)
