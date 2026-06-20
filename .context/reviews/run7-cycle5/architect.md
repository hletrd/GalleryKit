# Architect Review — run-7 cycle-5

- **HEAD reviewed:** `d38fa4a4` (build(sw): refresh SW_VERSION stamp 2848b394-p7 for run-7 cycle-4).
- **Last source-code commit:** `f5d7aaf7` (cycle-4 test pin, AGG-R7C4-01). Verified.
- **Lane:** architectural & design risk — coupling, layering, separation of concerns, abstraction boundaries, single-writer/single-web-instance topology integrity, advisory-lock coverage, config-resolution chain, PII select-field guard separation, migration/schema-drift safety, idempotency, check-then-act constraint backing.

## Verdict

**0 NEW actionable findings. Converged cycle — truthful zero.**

The diff from the cycle-4 source pin `f5d7aaf7` to HEAD, restricted to `apps/web/src/`, `apps/web/scripts/`, and `apps/web/drizzle/`, is **EMPTY**. Every source, script, and migration file is byte-identical to the converged cycle-4 HEAD. The only changes since the pin are cycle-4 review docs and the `public/sw.js` version stamp. **No architectural regression is possible by construction.** I did not trust that fact alone — I re-verified each in-scope structural invariant directly against the source at HEAD and ran the compile-time + behavioral gates that lock them. All hold. I also ran a fresh-eyes probe for a NEW cross-cutting design issue all 4 prior cycles might have missed (cross-row mutations lacking a needed lock; process-local state silently relied upon as durable; check-then-act without constraint backing). Nothing new surfaced.

## Source-immutability evidence

```
$ git diff --name-only f5d7aaf7..HEAD -- apps/web/src/ apps/web/scripts/ apps/web/drizzle/
[empty]

$ git diff --name-only f5d7aaf7..HEAD
.context/reviews/run7-cycle4/*.md   (12 review docs)
apps/web/public/sw.js                (version stamp only)
```

Source is the converged cycle-4 artifact. The cycle-3 finding ARCH-R7C3-01 (un-guarded `COLOR_IMPACTING_KEYS` subset) was implemented as AGG-R7C3-02 (`33ec5b30`) BEFORE this pin and verified-landed in cycle-4 — it is part of the converged baseline, not an open item.

## Invariant re-verification at HEAD (each independently checked, not inherited from prior reviews)

### 1. COLOR_IMPACTING_KEYS compile-time guard (ARCH-R7C3-01 → AGG-R7C3-02) — landed correctly, all 9 keys genuine
`apps/web/src/lib/settings-hash.ts:42-66`. The guard:
```ts
type _ColorKeysAreSettingKeys =
    (typeof COLOR_IMPACTING_KEYS)[number] extends GallerySettingKey ? true : never;
const _colorKeysAreSettingKeys: _ColorKeysAreSettingKeys = true;
```
- **Type source is canonical:** `GallerySettingKey` is `type`-imported (`settings-hash.ts:40`) from `gallery-config-shared.ts:73` (`typeof GALLERY_SETTING_KEYS[number]`) — tied to the single authoritative tuple, not a duplicate.
- **All 9 keys are real byte-impacting setting keys:** `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes` (`settings-hash.ts:42-54`). Cross-checked each against the encoder's config consumption at `image-queue.ts:322-332` — every one is read and passed to `processImageFormats`. No phantom or non-byte-impacting key in the list.
- **`buildHashFromConfig` covers the identical 9 keys** (`settings-hash.ts:89-101`) — config-arg path and DB path hash the same key set; no asymmetry.
- **Completeness (the orthogonal risk):** audited every `GALLERY_SETTING_KEYS` member NOT in the list — `strip_gps_on_upload` (mutates original, not derivative bytes), `allow_hdr_ingest` (ingest gate, not encode), `force_show_color_chips` / `slideshow_*` / `license_*` / `auto_alt_text_enabled` / `semantic_search_mode` (UI/metadata/search/pricing, no derivative-byte effect). Correctly excluded. The list is complete and correct for the current setting surface.
- **Honest bound documented:** the guard cannot catch a *forgotten new* byte-impacting key (a valid key is still a valid key); that residual is delegated to the CLAUDE.md "Adding a new color-impacting setting" checklist (`settings-hash.ts:56-62`). Exactly the bound the architect stated.
- **Gates green:** `vitest settings-hash.test.ts + privacy-fields.test.ts` → 23/23 passed.

### 2. Advisory-lock coverage — fully centralized, zero source drift, every cross-row mutation that needs a lock has one
`apps/web/src/lib/advisory-locks.ts:18-44`. All 6 names present: `LOCK_DB_RESTORE`, `LOCK_UPLOAD_PROCESSING_CONTRACT`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_ADMIN_DELETE`, `LOCK_COLOR_PIPELINE_BACKFILL`, `getImageProcessingLockName(jobId)`. Grepped every acquire/release call site across `src/` + `scripts/`: all reference the registry constants — **zero inline string-literal drift** (the only literal hit is a test fixture, `restore-upload-lock.test.ts:13`). Server-scope-not-DB-scope multi-tenant caveat documented in the module header (`:8-15`) and CLAUDE.md.

I specifically audited every mutating cross-row server action for a missing lock under single-writer:
- **`deleteAdminUser`** (`admin-users.ts:209-265`): `LOCK_ADMIN_DELETE` (5s timeout) **+** transaction; the table-wide "≥1 admin" invariant is read (`COUNT(*)`) and the delete executes inside the lock window. Correct — target-scoped locks would be insufficient (two different-user deletes could both pass the count); the global lock is the right choice.
- **`updateTopic` slug-rename** (`topics.ts:241-286`): the cross-row mutation (`topics` recreate + `images.topic` + `topicAliases.topicSlug`) runs inside `withTopicRouteMutationLock` (`LOCK_TOPIC_ROUTE_SEGMENTS`) **+** a DB transaction, with the authoritative row re-read INSIDE the transaction under the lock (`:259-266`, comment COR-R4C13-01/02 explicitly closes the prior `image_filename` TOCTOU). This is the OBS-R7C2-07 deferral surface — confirmed NOT a new break: the no-rename branch's read-without-FOR-UPDATE is already serialized by the advisory lock against any concurrent topic mutation under single-writer. No new correctness hole.
- **`createGroupShareLink`** (`sharing.ts:241-256`): `sharedGroups` + `sharedGroupImages` insert (with `position`) inside `db.transaction`. Atomic.
- **`deleteTopic` / `deleteGroupShareLink`**: transactional (`topics.ts:365`, `sharing.ts:359`).
- **Per-image processing claim** (`image-queue.ts:200-218`) and **backfill** (`admin-backfill-runner.ts:311-364`, `scripts/backfill-color-pipeline.ts:306-516`): acquire/release-symmetric on dedicated connections, released in `finally`/`.catch(()=>{})`, crash-safe via connection-close auto-release.

No mutating cross-row operation lacks a lock it needs under the documented single-writer model.

### 3. Check-then-act surfaces are backed by REAL DB constraints (not racey check-then-insert)
- `smart_collections.slug` — `.notNull().unique()` (`schema.ts:318`) → `createSmartCollection`/`updateSmartCollection` `ER_DUP_ENTRY` catch (`collections.ts:53,99`) is a genuine constraint violation, TOCTOU-safe.
- `entitlements.session_id` — `.notNull().unique()` (`schema.ts:299`) → webhook idempotency (SELECT + ON DUPLICATE KEY) is constraint-backed.
- `topics.slug` — `.primaryKey()` (`schema.ts:5`); `createTopic` catches `ER_DUP_ENTRY` (documented TOCTOU-safe pattern).

### 4. Config-resolution chain — clean layering, fails closed
`gallery-config-shared.ts` is pure/client-safe (the canonical `GALLERY_SETTING_KEYS` tuple `:25`, `GallerySettingKey` `:73`, `DEFAULTS` `:96`, `VALIDATORS` `:156`, `IMAGE_PIPELINE_VERSION = 7` `:21`). `gallery-config.ts` is the server resolver that imports `@/db` and re-exports the shared surface. Consumed once-per-job at `image-queue.ts:307-351`. The shared module is the single source of the key set and defaults; no duplication. (Fail-closed catch→DEFAULTS and `semantic_search_mode` heal-to-disabled were re-verified byte-identical to cycle-2/3/4 — unchanged source.)

### 5. PII select-field guard separation — compiler-enforced derivation intact
`data.ts`: `adminSelectFields` (full, `:208`) → `publicSelectFields` derived by destructuring-omission (`:355`, separate object reference) → `publicMapSelectFields` (`:391`). Three compile-time guards present: `_privacyGuard` (`:419`, `Extract<keyof publicSelectFields, PrivacySensitiveKeys> extends never`), `_mapPrivacyGuard` (`:431`, auto-derives the allowed set from `Exclude<PrivacySensitiveKeys,'latitude'|'longitude'>` so a new sensitive key auto-guards the map path), `_largePayloadGuard` (`:448`). `PrivacySensitiveKeys` is the single canonical union (`:416`, 20 keys). `cache()` count = 10 (matches CLAUDE.md). `privacy-fields.test.ts` green.

### 6. Migration / schema-drift runbook — structurally sound (fail-loud)
`scripts/migrate.js`: `getAllJournalMigrations` reads one record per journal entry with `hash = SHA256(file content)` (`:144-157`); `prepareLegacyDatabaseIfNeeded` checks `migrations.every(m => haveHashes.has(m.hash))` — NOT `MAX(created_at)` (`:687`); `baselineAllJournalMigrations` inserts one row per hash (`:646-656`); `runMigrations` post-condition THROWS `Drizzle silently skipped N migration(s)` if any journal hash is missing after `migrate()` (`:717`). The non-monotonic-journal foot-gun that burned production is fenced; future silent skips fail the deploy loud. Unchanged source.

## Single-writer / process-local-state sweep — no NEW reliance-as-durable break
Re-confirmed the documented process-local states (non-login rate-limit buckets, backfill-runner status, restore-maintenance flag, shared-group view-count buffer) remain correctly characterized as best-effort/operator-mitigated under the single-web-instance topology. The correctness-critical coordination (image-processing claim, backfill, restore, admin-delete, topic-rename, upload-contract) is fenced by advisory locks, and the login rate-limit bucket has a DB backup. No code path silently treats a process-local value as durable in a way that breaks correctness under the documented single-writer model. (These are documented design constraints; nothing NEW to file.)

## Carried deferrals re-verified UNCHANGED (NOT re-filed, per directive)
- ARCH-R7C2-01 (charge.refunded webhook gap) — webhook still handles only `checkout.session.completed`; bundle with plan-316. Deferred.
- OBS-R7C2-02..07 (reconcile position backfill, non-transactional restore, failRestore temp leak, pool not .end()'d, unbounded bootstrap retry, updateTopic no FOR UPDATE) — re-confirmed documented-design / operator-mitigated; OBS-R7C2-07 explicitly re-traced this cycle (the cross-row rename IS lock+txn-protected; the no-rename read is advisory-lock-serialized). Deferred.
- INFO-R7C2-08 (orphan 0014_drop_reactions.sql), INFO-R7C2-09 (lock-name separator) — cosmetic. Deferred.

## Summary table
| ID | Severity | Status |
|----|----------|--------|
| (none) | — | 0 new findings — converged cycle |

## References
- `apps/web/src/lib/settings-hash.ts:42-66,89-101` — COLOR_IMPACTING_KEYS + landed compile-time guard, all 9 keys.
- `apps/web/src/lib/image-queue.ts:307-351` — encoder config consumption (matches the 9 keys).
- `apps/web/src/lib/advisory-locks.ts:18-44` — centralized lock registry (6 names, zero source drift).
- `apps/web/src/app/actions/admin-users.ts:209-265` — last-admin guard (lock + txn).
- `apps/web/src/app/actions/topics.ts:241-286` — slug-rename cross-row mutation (lock + txn + in-txn re-read).
- `apps/web/src/db/schema.ts:5,299,318` — topics.slug PK, entitlements.session_id UNIQUE, smart_collections.slug UNIQUE (constraint-backed check-then-act).
- `apps/web/src/lib/data.ts:416-448` — PII guard union + 3 compile-time guards.
- `apps/web/scripts/migrate.js:144-157,687,717` — per-entry hash + every()-check + fail-loud post-condition.
- `git diff --name-only f5d7aaf7..HEAD -- apps/web/src apps/web/scripts apps/web/drizzle` → empty (source byte-identical to converged cycle-4).

## Verdict
**SOUND — converged.** All in-scope architectural invariants hold at HEAD, re-verified directly against source (not inherited from prior reviews) and locked by green compile-time + behavioral gates. The COLOR_IMPACTING_KEYS guard the architect recommended landed correctly with all 9 keys genuine. Source is byte-identical to the converged cycle-4 HEAD, so no regression is possible by construction. No CONCERNS-level (correctness/data-loss/privacy/security/layering-violation) finding; no schedulable LOW. Truthful zero.
