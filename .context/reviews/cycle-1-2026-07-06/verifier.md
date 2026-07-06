# Cycle 1 (2026-07-06) — Verifier Review

Scope: evidence-based correctness verification of CLAUDE.md's stated invariants/defaults against
actual code at HEAD `1d29b988` (working tree has uncommitted cycle-85 changes), plus verification
of the uncommitted cycle-85 plan's scheduled fixes (C85-02, C85-03). Read-only: no source files
modified. `.context/plans/cycle-85-2026-07-01-deferred.md` and the cycle-85 aggregate were read
first to avoid re-reporting known/deferred findings (`C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`,
`C75-08`).

## Uncommitted cycle-85 plan verification

Both scheduled fixes are implemented correctly and the tests that assert them pass:

- **C85-02** (`apps/web/src/__tests__/failed-image-retry.test.ts`): new test imports `en.json` /
  `ko.json` and asserts `dashboard.retryImageAria` and `dashboard.retryingImageAria` contain
  `{label}` in both locales. Confirmed directly: `en.json:73-74` = `"Retry processing {label}"` /
  `"Retrying processing {label}"`; `ko.json:73-74` = `"{label} 처리 재시도"` / `"{label} 처리 재시도 중"`.
- **C85-03** (`apps/web/src/__tests__/image-queue-permanent-failure.test.ts`): new
  `extractFnBody` brace-depth walker isolates `deleteImage` and `deleteImages` bodies separately
  and asserts each clears `queueState.permanentlyFailedIds.delete(id)`. Confirmed against
  `apps/web/src/app/actions/images.ts:697-699` (`deleteImage`, single `id`) and
  `apps/web/src/app/actions/images.ts:806-812` (`deleteImages`, `for (const id of foundIds)` loop).
- Ran both files: `Test Files 2 passed (2)`, `Tests 28 passed (28)`.

## Claim verification table

| # | Claim (CLAUDE.md / plan) | Evidence | Result |
|---|---|---|---|
| 1 | C85-02 fix: both locales pin `{label}` in retry aria templates | `en.json:73-74`, `ko.json:73-74`; test passes | PASS |
| 2 | C85-03 fix: `deleteImage`/`deleteImages` independently clear `permanentlyFailedIds` | `images.ts:697-699`, `:806-812`; test passes | PASS |
| 3 | `IMAGE_PIPELINE_VERSION` = 7 | `gallery-config-shared.ts:22` | PASS |
| 4 | `COLOR_IMPACTING_KEYS` = 9 keys (5 color + 3 quality + 1 size) | `gallery-config-shared.ts:75-85` (`DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS`) | PASS |
| 5 | Lock `gallerykit_db_restore` | `advisory-locks.ts:19` | PASS |
| 6 | Lock `gallerykit_upload_processing_contract` | `advisory-locks.ts:22` | PASS |
| 7 | Lock `gallerykit_topic_route_segments` | `advisory-locks.ts:25` | PASS |
| 8 | Lock `gallerykit_admin_delete` | `advisory-locks.ts:33` | PASS |
| 9 | Lock `gallerykit_color_pipeline_backfill` | `advisory-locks.ts:44` | PASS |
| 10 | Lock `gallerykit_semantic_embedding_backfill` | `advisory-locks.ts:47` | PASS |
| 11 | Lock template `gallerykit:image-processing:{jobId}` | `advisory-locks.ts:40-41` | PASS |
| 12 | `ADMIN_BACKFILL_CONCURRENCY` clamp: `RESERVED=max(3,ceil(limit/2))`, `cap=max(1,floor((limit-RESERVED-1)/2))`, = 2 at pool 10 | `admin-backfill-runner.ts:23-138` | PASS |
| 13 | `BACKFILL_CONCURRENCY` sidecar default 2, max 8 | `backfill-color-pipeline.ts:408-410` | PASS |
| 14 | `IMAGE_CLEANUP_CONCURRENCY` default 5, max 32 | `images.ts:848-852` | PASS |
| 15 | `QUEUE_CONCURRENCY` default 1 | `image-queue.ts:122-125` (fallback:1, max:8 — max undocumented but not contradictory) | PASS |
| 16 | `SHARP_CONCURRENCY` formula `max(1,floor((cpuCount-1)/3))`, explicit value capped at `cpuCount-1` | `process-image.ts:44-49` | PASS |
| 17 | `IMAGE_MAX_INPUT_PIXELS` default 268435456 | `process-image.ts:352-357` (`256*1024*1024`) | PASS |
| 18 | `IMAGE_MAX_INPUT_PIXELS_TOPIC` default 67108864 | `process-image.ts:363-369` (`64*1024*1024`) | PASS |
| 19 | `UPLOAD_MAX_TOTAL_BYTES` default 2147483648 | `upload-limits.ts:1,19` (`2 GiB`) | PASS |
| 20 | `UPLOAD_MAX_FILES_PER_WINDOW` default 100 | `upload-limits.ts:2,20` | PASS |
| 21 | `NEXT_UPLOAD_BODY_MAX_BYTES` default 278921216 | `upload-limits.ts:3-6,21` (`250MiB+16MiB`) | PASS |
| 22 | `AUDIT_LOG_RETENTION_DAYS` default 90 | `audit.ts:97-119` | PASS |
| 23 | `VIEW_RETENTION_DAYS` default 395 | `view-retention.ts:14,27` | PASS |
| 24 | `TRUSTED_PROXY_HOPS` default 1 | `rate-limit.ts:111,156-162` | PASS |
| 25 | Admin token format `gk_<base64url(32 bytes)>`, 46 chars total | `admin-tokens.ts:5,20-22,53-54` | PASS |
| 26 | Argon2id `memoryCost=65536, timeCost=3, parallelism=4` | `password-hashing.ts:12-14` | PASS |
| 27 | Login rate limit 5 attempts / 15-min window (both IP + account buckets) | `rate-limit.ts:66-67`, `auth-rate-limit.ts` | PASS |
| 28 | Session cookie `httpOnly`, `sameSite: lax`, `path: /`, `secure` in production | `auth.ts:236-245` | PARTIAL (see VER-01) |
| 29 | Migration monotonicity fix: hash-membership check replaces `MAX(created_at)` cursor; post-condition throws named error | `migrate.js:764-824` | PASS |
| 30 | Journal actually has non-monotonic `when` (mixed 2025/2026) that would poison a MAX-cursor | `_journal.json` — `0006_admin_tokens` (when=1778304060000, 2026-05-09) → `0007_image_reactions` (when=1746144000000, 2025-05-02); entries 0007-0017 all sit below the 0006 cursor | PASS |
| 31 | `sw.js` `SW_VERSION` matches `sha256(template + "\nPIPELINE=7").slice(0,8) + "-p7"` (no drift vs template) | Recomputed: `8fadda29-p7` == committed `public/sw.js` value | PASS |
| 32 | i18n key parity: same key set in `en.json`/`ko.json` | Flattened both: 850/850 keys, 0 missing either direction | PASS |
| 33 | Touch-target audit + i18n parity tests pass | `npx vitest run touch-target-audit.test.ts i18n-key-parity.test.ts` → 18/18 passed | PASS |
| 34 | CSV escape strips C0/C1, bidi/zero-width formatting, prefixes `=+-@` | `csv-escape.ts:39-58` | PASS |
| 35 | `semantic_search_mode` default `'disabled'`; resolver heals stored `'production'` to `'disabled'` without `SEMANTIC_SEARCH_ALLOW_PRODUCTION` | `gallery-config-shared.ts:120,223-229` | PASS |
| 36 | `CLIP_INFERENCE_CONCURRENCY` default 1, capped at 4 | `clip-model.ts:53-56` | PASS |
| 37 | `CLIP_INFERENCE_QUEUE_TIMEOUT_MS` default 30000, capped 300000 | `clip-model.ts:61-64` | PASS |
| 38 | `wide_gamut_max_source_pixels` default 50,000,000 | `gallery-config-shared.ts:141` | PASS |
| 39 | Encoder defaults: `avif_effort=6`, `image_quality_{webp,avif,jpeg}={90,85,90}`, `wide_gamut_jpeg_chroma=4:4:4`, `sdr_jpeg_chroma=4:2:0` | `gallery-config-shared.ts:109-138` | PASS |
| 40 | OG SSRF: `BASE_URL = process.env.BASE_URL \|\| siteConfig.url`; per-photo route pins internal fetch to this origin, not `req.url` | `constants.ts:24`; `route.tsx:177-196` | PASS |
| 41 | OG SSRF fail-closed: unparseable canonical URL falls back to `seo.url`, never request-derived origin | `route.tsx:188-196` | PASS |
| 42 | `OG_PHOTO_FETCH_TIMEOUT_MS=3500` strictly below `OG_PHOTO_TOTAL_BUDGET_MS=10000`; `OG_PHOTO_MAX_BYTES=1MB` | `og-photo-fetch.ts:31,41,54` | PASS |
| 43 | `MAX_BLUR_DATA_URL_LENGTH` = 4096 | `blur-data-url.ts:45` | PASS |
| 44 | Settings-hash `HASH_LENGTH=8`; ETag format `W/"v{PIPELINE}-{mtime}-{size}-{hash}"`, no extra slice | `settings-hash.ts:61,74`; `serve-upload.ts:229-230` | PASS |
| 45 | `image_sizes` sorted ascending before hashing (order-independent ETag) | `settings-hash.ts:92` | PASS |
| 46 | `withTopicRouteMutationLock` wraps all 4 of create/update/delete Topic + createTopicAlias | `topics.ts:62,140,250,433,516` (4 call sites) | PASS |
| 47 | `HEALTH_CHECK_DB` gates DB probe in `/api/health`; `/api/live` exists as separate liveness route | `app/api/health/route.ts:19`; `app/api/live/` exists | PASS |
| 48 | Last admin deletion prevented | `admin-users.ts:236-283` (`adminCount <= 1` → `cannotDeleteLastAdmin`) | PASS |
| 49 | DB restore validates file header and uses `--one-database` | `db-actions.ts:597,675` | PASS |

**Totals: 49 claims checked — 48 PASS, 1 PARTIAL, 0 FAIL.**

## Findings

### VER-01 — Session cookie `secure` doc is a simplification of the actual condition

- Severity: Very Low (documentation completeness, not a functional bug — the actual behavior is a
  **superset** of the documented one, so nothing insecure is implied).
- Confidence: High.
- Classification: Documentation drift.
- File: `apps/web/CLAUDE.md` ("Cookie attributes" bullet) vs `apps/web/src/app/actions/auth.ts:236-245`.
- Why: CLAUDE.md states the session cookie is `secure` "(in production)". The actual code sets
  `secure: requestIsHttps || process.env.NODE_ENV === 'production'` — i.e., it is *also* `secure`
  in non-production when the request arrives over a TLS-terminating proxy (matching the
  same trusted-protocol normalization used for CSRF/origin checks). This is intentionally more
  conservative than the doc implies, not less.
- Failure scenario: none functional. A reader relying solely on the doc could wrongly assume a
  staging environment behind HTTPS never gets a `Secure` cookie, when it actually does.
- Fix: optionally update the CLAUDE.md bullet to read "`secure` when the effective request
  protocol is HTTPS or in production" to match `getTrustedRequestProtocol`-based logic exactly.

### VER-02 — Untracked `.context/reviews/cycle-94-2026-07-01/` artifacts sit alongside cycle-85 in the working tree

- Severity: Very Low (repo/process hygiene, not a code-correctness defect).
- Confidence: Medium.
- Classification: Workspace/artifact hygiene.
- File: `.context/reviews/cycle-94-2026-07-01/*.md` (untracked; `git status` shows the whole
  directory as `??`).
- Why: these four review files (`designer.md`, `perf-architect.md`, `security-reviewer.md`,
  `test-engineer.md`) reference repo path `/tmp/gallery-recovery-check` and HEAD
  `33eca7b5e4102bd5097777dbb926ee2cb94c6d71`. That commit does exist in this repo's history
  (`git cat-file -e` confirms it, and it actually precedes several "cycle 95-99" commits that are
  ancestors of the current `1d29b988` "cycle 84" HEAD — this repo's cycle-number commit messages
  are not chronologically monotonic, a pre-existing property of the history, not something this
  session introduced). The cycle-85 review directory's `_aggregate.md` also carries a materially
  newer mtime (today) than its sibling lane files (2026-07-01), consistent with the cycle-85
  aggregate's own "Agent Failures" note that an NFS-worktree interruption caused a recovery
  re-run — not a new defect, just confirms that note.
- Failure scenario: none for product code. A future cycle could be confused about which review
  artifacts are authoritative for which HEAD if these stray, uncommitted cycle-94 files are
  mistaken for current-cycle output.
- Fix: none required for product correctness. If desired, `git clean`/relocate stray
  `cycle-94-2026-07-01/` artifacts once their provenance is confirmed, or fold them into the
  ledger under the correct cycle number.

## Final sweep

Re-scanned the claim list against `.context/plans/cycle-85-2026-07-01-deferred.md` and the
cycle-85 `_aggregate.md` to confirm none of VER-01/VER-02 duplicate `C80-06`, `C77-ARCH-01`,
`C76-04`, `C76-05`, or `C75-08` — they don't overlap (those are runtime/behavioral gaps in
site-config, restore-fencing, portal coverage, processed-predicate coverage, and bulk-edit a11y;
VER-01/VER-02 are doc-precision and workspace-hygiene notes only). No additional load-bearing
CLAUDE.md claim was found to contradict the code in this pass.
