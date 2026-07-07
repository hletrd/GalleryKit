# Document-Specialist Review — Cycle 5 (2026-07-07)

Start HEAD: `d9bcbf4c` (clean tree except unstaged edits to sibling lane review files, which
this lane does not touch). Scope: doc/code mismatches across the whole repo, with explicit
verification that cycle-4's doc fixes (C4-35..C4-41) actually landed, plus a fresh hunt for
drift cycle 4 didn't cover.

## Cycle-4 doc-fix verification (all CONFIRMED fixed — do not re-report)

| Finding | Claim | Verified against | Status |
|---|---|---|---|
| C4-35 | "DDL-only invariant" for `reconcileLegacySchema` | `CLAUDE.md:449` now reads "DDL-only invariant (qualified, C4-35)" and explicitly carves out the one `shared_group_images.position` backfill exception | FIXED |
| C4-36 | SW touchMeta recency/lifetime/size-0 invariants undocumented | `CLAUDE.md:432` now has a dedicated "LRU meta invariants (C4-36)" paragraph covering all three invariants + the phantom-entry fix (C4-02) | FIXED |
| C4-37 | Plans README lists cycle-3 as "Active" | `.context/plans/README.md` "Active Current-Cycle Plans" now lists cycle 4; cycle 3 moved to "Recent Plans" marked COMPLETED + deployed | FIXED |
| C4-38 | `RESTORE_MAINTENANCE_DIR` undocumented env row | `CLAUDE.md:112` now has the row, matches `restore-maintenance-durable.ts:24` and `restore-maintenance-recovery.mjs:21` | FIXED (see new completeness gap below, DOC5-03) |
| C4-39 | CLAUDE.md quotes `trueDriftEntries`; real variable is `trueDrift` | `CLAUDE.md:449` now says `baselineAllJournalMigrations(connection, trueDrift, { maxFolderMillis: cursor })` — matches `migrate.js` variable name | FIXED |
| C4-40 | `apps/web/README.md` "2000+ tests" ~35% stale | `apps/web/README.md:37` now reads `| npm test | Vitest unit suite |` — the stale count was dropped entirely | FIXED (but see DOC5-01 — the same stale claim survives in a sibling file) |
| C4-41 | ETag section says backfill "rewrites bytes in place"; migrate.js claims a drizzle-side per-entry hash check that doesn't exist | `CLAUDE.md:212` now says "temp-file write + `fs.rename` atomic rename-over ... NOT an in-place byte rewrite"; `CLAUDE.md:444` now says "informational only, migrate.js uses its own hash-based post-conditions" / "not per-entry hashes" | FIXED |

## New findings (cycle 5)

### DOC5-01 (MED/High, Confirmed) — `AGENTS.md:37` still carries the exact stale test-count claim that C4-40 fixed in the sibling README

- **Doc:** `AGENTS.md:37`: `` `npm test --workspace=apps/web` — Vitest 2000+ unit tests including the touch-target audit (≥ 44 px) and the `_PrivacySensitiveKeys` symmetric privacy guard ``
- **Code:** ran `npm test` at HEAD `d9bcbf4c`: `Test Files 333 passed | 2 skipped (335)` / `Tests 3113 passed | 4 skipped (3117)`.
- **Mismatch:** the "2000+" figure was accurate when it was written — `plan/done/plan-333-run8-cycle2-fixes.md:90` shows this exact line was updated from "1300+" to "2000+" (measured "real ~2035") back in run-8 cycle-2. `AGENTS.md` and `apps/web/README.md` had duplicate copies of the same claim. Cycle-4's C4-40 fix corrected `apps/web/README.md` (by deleting the count) but never touched `AGENTS.md`, which still carries the original run-8-vintage number — now a ~53% understatement (2000+ vs. 3113 actual) and stale in the same direction/class as the just-fixed finding.
- **Why it misleads:** `AGENTS.md` is the canonical short-form entry point for AI agents ("This file is the canonical short-form reference for AI agents and contributors" — `AGENTS.md:3`), so an agent sizing the test suite from this file alone underestimates real coverage by over 1000 tests, and the file is more likely to be read first than the full `CLAUDE.md`.
- **Suggested correction:** apply the same fix as C4-40 — either drop the count (`` `npm test --workspace=apps/web` — Vitest unit tests including the touch-target audit (≥ 44 px) and the `_PrivacySensitiveKeys` symmetric privacy guard `` ) or update it to the measured value with a low-precision qualifier (e.g. "3000+"). Given this has now drifted twice (1300+ → 2000+ → stale again), dropping the literal count is the more durable fix — matches what C4-40 already did to the README copy.
- **Confidence:** High (mechanically reproduced via `npm test`, and the prior-fix provenance is documented in `plan/done/plan-333-run8-cycle2-fixes.md`).

### DOC5-02 (INFO/Low, Confirmed) — sibling doc copies of the same fact can drift independently; no cross-reference exists

Same root cause as DOC5-01: `CLAUDE.md`'s own Testing section (`CLAUDE.md:645`) never carried a hardcoded count and is clean. `apps/web/README.md` had the count and was fixed. `AGENTS.md` had the count and was not. This is a process observation, not a new fact-mismatch: whenever a cycle "fixes" a fact that is duplicated in `AGENTS.md` and `apps/web/README.md`, the fix pass should grep for the same literal string across all three doc surfaces (`CLAUDE.md`, `AGENTS.md`, `apps/web/README.md`) rather than fixing only the file the finding named. No action needed beyond DOC5-01 itself; noted so the cycle-5 fix pass doesn't re-introduce the same partial-fix pattern on other duplicated facts.

### DOC5-03 (LOW/Med, Confirmed) — `.env.local.example` doesn't carry a commented-out `RESTORE_MAINTENANCE_DIR` entry to match its new CLAUDE.md env-table row

- **Doc:** `CLAUDE.md:112` (added by the C4-38 fix) documents `RESTORE_MAINTENANCE_DIR` as a production-reachable operational env var with a real default (`/app/data` prod / `data` dev) that "must live on the persisted `./data` bind mount so the marker survives process restarts."
- **Code:** `apps/web/.env.local.example` has commented-out example rows for essentially every other operational var in that same CLAUDE.md table (`SHARP_CONCURRENCY`, `QUEUE_CONCURRENCY`, `IMAGE_MAX_INPUT_PIXELS(_TOPIC)`, `ADMIN_BACKFILL_CONCURRENCY`, `BACKFILL_CONCURRENCY`, `IMAGE_CLEANUP_CONCURRENCY`, `UPLOAD_ORIGINAL_ROOT`, `AUDIT_LOG_RETENTION_DAYS`, `VIEW_RETENTION_DAYS`, `UPLOAD_MAX_TOTAL_BYTES`, `UPLOAD_MAX_FILES_PER_WINDOW`, `NEXT_UPLOAD_BODY_MAX_BYTES`, `TRUST_PROXY`, `TRUSTED_PROXY_HOPS`, `HEALTH_CHECK_DB`, all six CLIP/semantic vars) — but has no entry at all for `RESTORE_MAINTENANCE_DIR`.
- **Why it's a (minor) gap, not a wrong claim:** the code default is safe (derives correctly per environment via `restore-maintenance-durable.ts:24`), so nothing is broken. But CLAUDE.md itself flags this as a "production-reachable knob," and it is the only operational var in the whole CLAUDE.md table that has no discoverable example line in the file operators are told to copy-and-customize (`README.md` Quick Start: `cp .env.local.example .env.local`). An operator who needs to override it (e.g. a non-standard `./data` mount path) has no in-file hint that the variable exists.
- **Suggested correction:** add one commented-out line to `apps/web/.env.local.example`, e.g. under a "Restore maintenance" heading: `# RESTORE_MAINTENANCE_DIR=/app/data  # Durable restore-marker directory; must live on the persisted ./data mount`.
- **Confidence:** Medium (the gap is real and verified; severity is low because the default is safe and the var is already documented in CLAUDE.md's authoritative table — this is a discoverability nit, not a correctness bug).

## Broad verification pass — no new mismatch found (for the record, so cycle 6 doesn't re-check these)

Cross-checked the following CLAUDE.md claims directly against source/config at HEAD `d9bcbf4c`; all confirmed accurate:

- `IMAGE_PIPELINE_VERSION = 7` (`gallery-config-shared.ts:22`) — matches all three CLAUDE.md mentions.
- `COLOR_IMPACTING_KEYS` = 9 total (5 color + 3 quality + 1 size) in `settings-hash.ts` — matches "all **9**" claim; `HASH_LENGTH = 8` — matches "already 8 chars" claim.
- DB pool: `POOL_CONNECTION_LIMIT = 10`, `queueLimit: 20` (`db/index.ts`) — matches "Connection pool: 10 connections, queue limit 20."
- `admin-backfill-runner.ts` concurrency formula (`cap = max(1, floor((POOL_CONNECTION_LIMIT − RESERVED − 1) / 2))`, `RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2))` → cap = 2 at pool 10) — docstring in code and CLAUDE.md prose match exactly, arithmetic verified by hand.
- `package.json` stack versions vs. CLAUDE.md Tech Stack: `next ^16.2.9` / React `^19.2.5` / `typescript ^6` / Node `engines: >=24` — all match "Next.js 16.2", "React 19", "TypeScript 6", "Node.js 24+". (Aside, not a doc mismatch: `sharp` is pinned `^0.34.5`, which — because npm caret ranges on `0.x.y` only allow patch bumps — mathematically excludes the now-published `0.35.3` line; CLAUDE.md doesn't claim a Sharp version so this isn't a doc/code mismatch, just a dependency-freshness aside for whoever owns dependency bumps.)
- nginx `client_max_body_size`: 2M generic / 64K login / 250M restore / 216M dashboard / 216M LR-upload, plus the longest-prefix-match precedence of `^~ /api/admin/lr/upload` over `^~ /api/admin/` — all match `apps/web/nginx/default.conf` byte-for-byte and match README.md's mirrored numbers.
- Env var defaults spot-checked against source: `SHARP_CONCURRENCY` formula (`max(1, floor((cpuCount-1)/3))`, capped at `cpuCount-1`), `IMAGE_MAX_INPUT_PIXELS` (256M) / `_TOPIC` (64M), `UPLOAD_MAX_TOTAL_BYTES` (2 GiB) / `UPLOAD_MAX_FILES_PER_WINDOW` (100), `AUDIT_LOG_RETENTION_DAYS` (90), `IMAGE_CLEANUP_CONCURRENCY` (default 5, max 32), `NEXT_UPLOAD_BODY_MAX_BYTES` (266 MiB = max(200,250) + 16 MiB = 278921216), `BACKFILL_CONCURRENCY` sidecar (default 2, max 8), `SEMANTIC_SCAN_LIMIT` (2000) / `SEMANTIC_TOP_K_MAX` (50), `TRUSTED_PROXY_HOPS` (default 1), `HEALTH_CHECK_DB` gate — every one matches its CLAUDE.md-documented default exactly.
- Admin token format: `gk_` + `base64url(32 bytes)` = 3 + 43 = 46 chars total (`admin-tokens.ts`) — matches CLAUDE.md exactly; scope enum `'lr:upload' | 'lr:read' | 'lr:delete'` matches.
- `smart_collections` schema (`slug`, `name`, `query_json` text column, `is_public`) — matches CLAUDE.md's description of "a JSON predicate AST in the `query_json` column."
- `csv-escape.ts` — formula-char guard (`=+-@`), C0/C1 strip, Unicode bidi/zero-width strip (reusing `UNICODE_FORMAT_CHARS` from `validation.ts`), CRLF collapse — matches the Security Architecture section's CSV description feature-for-feature, including the "tab already stripped by C0/C1 pass, removed from the formula char class" detail.
- SW template constants: `MAX_IMAGE_BYTES = 50 * 1024 * 1024` and `HEAD_REVALIDATE_TIMEOUT_MS = 300` (`sw.template.js`) — matches "50 MB LRU cap" and "300 ms" claims.
- SW version-stamp freshness: recomputed `build-sw.ts`'s exact hash algorithm (`sha256(template + "\nPIPELINE=7")`, sliced to 8 hex chars) by hand against the committed `public/sw.template.js` — produces `ccbc2e28-p7`, which is exactly what's stamped into the committed `public/sw.js`. Confirms the "after editing the template, regenerate and commit sw.js" invariant is currently honored (this is a *different*, newer hash than cycle-4's verifier recorded — `26516421-p7` — because the template changed since cycle 4 for the C4-36/C4-02 documentation and phantom-entry fixes and was correctly regenerated; not drift).
- Stripe/paid-download removal: `grep -rl "stripe|license_tier|entitlements"` across `apps/web/src` and `package.json` returns nothing — matches the "Permanently Deferred" section's claim that the feature was fully removed.
- Storage abstraction: `apps/web/src/lib/storage/` contains only `index.ts` / `local.ts` / `types.ts`, no S3/MinIO client code — matches the "Storage Backend (Not Yet Integrated)" note.
- `docker-compose.yml` / `Dockerfile`: `network_mode: host`, `TRUST_PROXY: "true"`, the three bind mounts (`./data`, `./public/uploads`, `./public/resources`) plus the read-only `site-config.json` mount, and the runner-stage `mkdir -p .../data/models/clip` — all match CLAUDE.md's deployment/CLIP-seeding descriptions.
- `apps/web/tsconfig.json`: `target: "ESNext"`, `module: "esnext"` — consistent with the user's global "always target ESNext" convention (not a repo-doc claim, but confirms no drift here either).
- Historical migration errata claim ("older migration comments may mention... Lightroom plugin or Florence-2") — confirmed still true: `0006_admin_tokens.sql` and `0011_image_alt_text_suggested.sql` still carry those historical comments, so the disclaimer in CLAUDE.md remains necessary and accurate.
- Photographer-review directory claims (`photographer-r3/`, `photographer-r4/`, `cycle1-rpf-photographer/` … `cycle8-rpf-photographer/`) — all exist under `.context/reviews/`.

## Summary

- **Cycle-4 doc fixes (C4-35..C4-41):** all 7 verified as actually landed in `CLAUDE.md` / `.context/plans/README.md`. No re-reports.
- **New findings this cycle:** 3 (1 MED/High confirmed test-count staleness in `AGENTS.md`; 1 INFO/Low process note; 1 LOW/Med `.env.local.example` completeness gap for `RESTORE_MAINTENANCE_DIR`).
- **Broad sweep:** ~25 additional CLAUDE.md factual claims (version pins, numeric defaults/formulas, schema shapes, security invariants, SW hash freshness, deployment config) were cross-checked directly against source/config and all confirmed accurate — no drift found. The repo's documentation is unusually well-synchronized with code after 4+ review cycles of dedicated doc scrutiny; remaining doc debt is now shallow (duplicated-fact partial fixes, example-file parity) rather than substantive factual drift.
