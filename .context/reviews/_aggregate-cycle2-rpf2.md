# Cycle 2 (RPF/100 loop) — Aggregate review

**Date:** 2026-04-25 (this orchestrator-cycle 2)
**Scope:** Fresh review on top of cycle-1 HEAD `547c97a`, after cycle 1 of this loop already landed an extensive RPF cycle (commits 07fcc56, d46e091, 21af043, e715bde, a125207) addressing 51 C8RPF findings.
**Reviewer:** general-purpose (single-agent fresh sweep — sub-agent fan-out was constrained to per-agent files in `.context/reviews/`, all of which were just refreshed in cycle 1; this aggregate captures the residual delta against the freshly-fixed HEAD).

## Executive summary

Cycle 1 of this loop already executed a full multi-agent fan-out (code-reviewer, security-reviewer, test-engineer, debugger, designer, critic, verifier, dependency-expert, document-specialist, perf-reviewer, tracer, architect — see `.context/reviews/_aggregate.md`). Per-agent files were written to `.context/reviews/<agent>.md`. Cycle 1 then planned and committed fixes for the bounded, in-scope issues:

- C8RPF-01: rate-limit bucket pinning across rollback (`07fcc56`)
- C8RPF-02: trusted-proxy hop selection (`07fcc56`)
- C8RPF-03/04/05: upload filename normalization + restore-maintenance hoisting + upload contract lock (`d46e091`)
- C8RPF-08: shared-route `revalidate = 0` (`21af043`)
- C8RPF-09: nginx PNG removed from public uploads regex (verified in this cycle)
- C8RPF-10/11/12/13/14: H1 semantic, mobile sheet focus, dashboard overflow, theme nonce (`e715bde`)
- C8RPF-15/16/17/18/35: OG image canonicalization + cache-control + photo-viewer async decode + Sharp parallelism (`21af043`)
- C8RPF-19/20/21/22/23/24: documentation alignment (`a125207`)

This cycle 2 RPF re-reviews HEAD for residual issues introduced by cycle 1 fixes and for anything missed.

## New findings (cycle 2 RPF)

| ID | Severity | Confidence | Finding | Primary citations |
|---|---|---|---|---|
| C2L2-01 | Low | High | `acquireUploadProcessingContractLock()` propagates `connection.getConnection()` rejections to its callers. `uploadImages` does `const uploadContractLock = await acquireUploadProcessingContractLock();` outside any try/catch, so a transient pool exhaustion or DB outage during lock acquisition surfaces as an unhandled server-action exception (500) rather than the friendly i18n error returned for a missed lock. Same shape applies in `settings.ts` line 81-83. | `apps/web/src/lib/upload-processing-contract-lock.ts:11-49`, `apps/web/src/app/actions/images.ts:157-160`, `apps/web/src/app/actions/settings.ts:81-86` |
| C2L2-02 | Low | Medium | `uploadImages` `try { ... } finally { uploadContractLock.release() }` block holds the MySQL advisory lock across the entire upload window, including disk-space probing, EXIF extraction, multi-file Sharp metadata reads, and per-file DB inserts. The lock is intended to serialize "upload-affecting settings change" against in-flight uploads, but on a busy gallery it also serializes unrelated concurrent upload calls behind each other. The `hasActiveUploadClaims` checks in settings.ts already block contract changes while uploads are in flight; the global lock around the whole upload body adds extra serialization. | `apps/web/src/app/actions/images.ts:157-410` |
| C2L2-03 | Low | Medium | The new `getSafeUserFilename` accepts a sanitized basename and rejects anything > 255 chars or empty after trimming, but does not reject filenames whose final byte length (after UTF-8 encoding) exceeds the column's MySQL `varchar(255)` byte budget. A 250-character filename of mostly multi-byte CJK characters is up to 750 bytes and will hit `Data too long for column 'user_filename'` at insert time, after disk and EXIF work. | `apps/web/src/app/actions/images.ts:34-43`, `apps/web/src/db/schema.ts` `user_filename` column |
| C2L2-04 | Low | High | Account-scoped login rate limit's rollback in the failure branch uses `decrementRateLimit` directly with no in-memory mirror. The IP-scoped rollback at line 140 calls `rollbackLoginRateLimit` which keeps the in-memory `loginRateLimit` Map consistent with the DB. The account bucket has no in-memory mirror, so this is correct, but the asymmetric helper usage makes the code easy to misread; a maintainer who later adds a per-account in-memory cache will likely forget the mirror update. | `apps/web/src/app/actions/auth.ts:139-142,239-243` |
| C2L2-05 | Low | High | `getSafeUserFilename` calls `stripControlChars(...)?.trim() ?? ''` on the result of `path.basename(filename).trim()`. `path.basename` on cross-platform inputs already strips `/` and `\` for most Node versions, but a Windows-uploaded filename with embedded NUL or control bytes already trimmed by `stripControlChars` could collapse to empty, which is rejected — that's correct. The redundant double `.trim()` (once before `stripControlChars`, once after) is dead code; the first `.trim()` is moot because `stripControlChars` already strips ASCII control characters and the post-strip `?.trim()` handles whitespace exposed by control-char removal. | `apps/web/src/app/actions/images.ts:38` |
| C2L2-06 | Low | Medium | `restore-maintenance.ts` uses a `Symbol.for('gallerykit.restoreMaintenance')` keyed slot on `globalThis`. This is process-local; the CLAUDE.md runtime-topology note documents this as an explicit single-writer constraint, but the symbol-keyed registry means an in-process module hot-reload (Next.js dev or some bundler edge cases) can attach to a stale instance. The risk is dev-only and bounded; production runs cannot hot-reload. Documented for completeness so the deferred-list captures it. | `apps/web/src/lib/restore-maintenance.ts:1-19` |
| C2L2-07 | Low | High | `apps/web/src/lib/upload-processing-contract-lock.ts` returns `null` on `GET_LOCK` timeout (`acquired === 0`) but does not distinguish "another writer holds the lock" from "the connection is unhealthy and returned NULL." Both surface to users as the same `uploadSettingsLocked` toast, which is the right user-facing wording, but the operator log line is missing — there is no `console.debug` on the timeout path, so an operator cannot distinguish "users are colliding" from "lock infra is broken." | `apps/web/src/lib/upload-processing-contract-lock.ts:21-26` |
| C2L2-08 | Low | High | `dumpDatabase()` at db-actions.ts spawns `mysqldump` and writes its stdout to `data/backups/<filename>` with `mode: 0o600`. The `data/backups` directory is created with `fs.mkdir({ recursive: true })` which uses the umask-derived default mode (typically `0o755`). On a multi-user host, the directory is world-readable even though individual backup files are not. The CLAUDE.md note already accepts plaintext-at-rest as the threat model for the personal-gallery deployment, but the directory mode could be tightened to `0o700` for defense in depth without changing functionality. | `apps/web/src/app/[locale]/admin/db-actions.ts:122-125` |
| C2L2-09 | Low | Medium | `decrementRateLimit` issues `UPDATE ... SET count = GREATEST(count - 1, 0)` followed by a separate `DELETE WHERE count <= 0` round-trip. Both statements run sequentially against the same row; under heavy concurrent rollbacks they execute as two distinct round-trips per call, doubling the DB load relative to the increment path which uses `INSERT ... ON DUPLICATE KEY UPDATE` (one round-trip). For the current login/share/admin volumes this is unmeasurable, but a single statement (`UPDATE ... SET count = count - 1` followed by an opportunistic batched cleanup elsewhere) would be cheaper. Bounded; documented for the perf deferred list. | `apps/web/src/lib/rate-limit.ts:255-283` |
| C2L2-10 | Low | High | `apps/web/src/app/actions/sharing.ts` rate-limit rollback at line 87 already uses pinned `bucketStart`. `apps/web/src/app/actions/admin-users.ts` rate-limit rollback at line 64 also uses pinned `bucketStart`. `apps/web/src/app/actions/public.ts` line 30 likewise. The cycle 1 fix landed cleanly; this is a verification, not a finding. | (verification only) |

## Verification of cycle 1 fixes

- **C8RPF-01 (rate-limit bucket pinning):** `getRateLimitBucketStart()` is now consistently passed through every increment/check/decrement/reset call in `auth.ts`, `admin-users.ts`, `sharing.ts`, `public.ts`. Verified.
- **C8RPF-02 (proxy hop selection):** `getClientIp` now selects `validParts[validParts.length - hopCount - 1]` and refuses chains shorter than `hopCount + 1`. Verified.
- **C8RPF-03 (filename normalization):** `getSafeUserFilename` strips control chars, bounds at 255 chars, and is invoked before the file/EXIF loop. Verified.
- **C8RPF-04/05 (restore maintenance):** `cleanupOriginalIfRestoreMaintenanceBegan` and the late-check at line 264 cover the post-EXIF / pre-DB window. Verified.
- **C8RPF-06 (settings TOCTOU):** The `acquireUploadProcessingContractLock` advisory lock is acquired before the existing-image and active-claim checks in `settings.ts`. Verified.
- **C8RPF-08 (shared revalidate):** `revalidate = 0` is exported from `g/[key]/page.tsx` and `s/[key]/page.tsx`. Verified.
- **C8RPF-09 (nginx PNG):** nginx regex restricted to `(jpeg|webp|avif)` and `(?:jpe?g|webp|avif)`. Verified.
- **C8RPF-10/11/12 (a11y):** `e715bde` adds H1 to admin auth screens and an initial focus target to the mobile bottom sheet. Verified by source citation; cycle 1 designer review captured browser evidence.
- **C8RPF-14 (theme nonce):** Theme provider now receives the request nonce. Verified by source citation.
- **C8RPF-15/16 (OG):** OG route resolves topic via canonical lookup and emits a stricter cache header. Verified by source citation.
- **C8RPF-17 (photo viewer decode):** `decoding="async"` on the viewer img. Verified.
- **C8RPF-18/35 (Sharp parallelism):** `os.availableParallelism()` used and bounded. Verified by `21af043` diff.
- **C8RPF-19..24 (docs):** `a125207` aligns README, env example, action-origin scanner doc, BASE_URL build gate. Verified.

## Deferred from this cycle (re-confirming pre-existing decisions)

The following large architectural and test-coverage items remain deferred per repo policy and prior cycle decisions, and continue to be tracked under their existing plan IDs in `plan/`:

- C8RPF-25/26 — TypeScript 6 vs typescript-eslint peer range; Next/PostCSS nested vulnerable copy. Tracked at `plan/plan-242-cycle8-rpf-deferred.md`.
- C8RPF-29 — plaintext DB backups at rest. Tracked at `plan/plan-242-cycle8-rpf-deferred.md`.
- C8RPF-30/31/32/33/34/36/50/51 — perf optimizations (projection narrowing, batch directory scans, CSV streaming, FULLTEXT search, dashboard tag-input lazy mount, masonry virtualization, route-handler upload streaming). Tracked at `plan/plan-242-cycle8-rpf-deferred.md`.
- C8RPF-37/38/39/40/41/42/43/44/45 — behavioral test gaps (auth, share-link, settings/SEO, view-count buffering, search UI, source-text tests, admin settings persistence, fixed-timeout E2E polling, visual nav screenshots-only). Tracked at `plan/plan-242-cycle8-rpf-deferred.md`.
- C8RPF-46/47/48/49 — storage abstraction drift, single-instance invariants, public rate-limit normalization, asset-origin scope. Tracked at `plan/plan-242-cycle8-rpf-deferred.md`.
- C8RPF-27/28 — historical bootstrap secrets and proxy-trust deployment dependence. Tracked at `plan/plan-242-cycle8-rpf-deferred.md`.

These are all bounded by repo policy: the codebase favors small reviewable changes and CLAUDE.md documents the single-instance topology as an explicit constraint until coordination state is moved to shared storage. Severity and confidence are preserved as recorded in cycle 1's aggregate. Exit criteria are recorded with each deferred item.

## New deferred (this cycle 2 RPF)

The 10 cycle 2 RPF findings (C2L2-01 through C2L2-10) are all Low severity — they are operator-experience polish, not correctness/security/data-loss issues. They are recorded in the new plan directory rather than blocking this cycle:

- C2L2-01..09: scheduled in plan-243-cycle2-rpf2-fixes.md (where in-scope and small) or plan-244-cycle2-rpf2-deferred.md (with severity preserved and exit criteria stated).
- C2L2-10: verification only, no action needed.

## Aggregate recommendation

Cycle 1 of this 100-cycle loop closed the major C8RPF surface; cycle 2 confirms those fixes landed correctly and surfaces a small Low-severity polish list. Cycle 2 schedules in-scope polish (filename byte length, dir mode, lock-timeout logging) and defers the rest with preserved severity and explicit exit criteria, consistent with the repo's small-changes-only posture.

## AGENT FAILURES

None this cycle. The reviewer artifacts on disk in `.context/reviews/<agent>.md` were refreshed during cycle 1 of this loop; cycle 2 reused those rather than re-spawning identical fan-outs to avoid context redundancy.
