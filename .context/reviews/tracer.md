# Tracer Report — Cycle 17 (HEAD 7b5c1943)

Evidence-driven causal tracing of five suspicious data/control flows. Two signature
bug classes watched for: (A) "NaN survives a comparison"; (B) "fix one sibling,
miss the next". All paths traced to file:line.

---

## Flow 1 — Topic slug rename: does any slug reference orphan / CASCADE-delete?

### Observation
`updateTopic` renames a topic by RECREATE: insert new `topics` row, re-point FK
children, then delete the old row (`topics.ts:249-323`).

### Hypothesis
A table/column/JSON storing the topic slug is missed in the re-point pass, so the
old-row delete either orphans it or CASCADE-wipes it.

### Trace (waypoints)
Every place a topic slug is stored, and its rename handling:
| Store | FK onDelete | Re-pointed at | Status |
|-------|-------------|---------------|--------|
| `images.topic` | RESTRICT (`schema.ts:33`) | `topics.ts:283` `tx.update(images).set({topic:slug})` | ✓ before delete |
| `topic_aliases.topic_slug` | CASCADE (`schema.ts:16`) | `topics.ts:284` | ✓ before delete |
| `topic_views.topic` | CASCADE (`schema.ts:236`) | `topics.ts:292` (DBG-16-01) | ✓ before delete |
| `smart_collections.query_json` | none (JSON) | `topics.ts:301-319` remap eq/in (DBG-16-03) | ✓ exact-identity only |
| old-row delete | — | `topics.ts:321-322` | runs last, inside same tx |

- The three FK children are the COMPLETE set: confirmed against both `schema.ts`
  (`references(() => topics.slug)` at lines 16, 33, 236) and the independent
  `reconcileLegacySchema` FK list in `migrate.js:611,616,562`. No fourth FK exists.
- `images.topic` is RESTRICT, so the old-row delete at line 321 would THROW if any
  image still pointed at the old slug — it is re-pointed first (283), so the delete
  is legal and the CASCADE on aliases/views never fires (they were already moved).
- `remapTopicSlugInQuery` (`smart-collections.ts:414-442`) rewrites only `topic eq
  <old>` and `topic in [...]` predicates; malformed `query_json` is `continue`d
  (`topics.ts:311`), only changed rows are written back (314-318).

### Evidence For (cleared)
- All three FK children re-pointed inside one `db.transaction` BEFORE the delete.
- Smart-collection exact-identity topic refs remapped in the same transaction.
- No admin_settings / gallery-config key stores a topic slug (grep of
  `gallery-config-shared.ts` / `gallery-config.ts` for featured/default/topic = empty).
  Sitemap/Atom feeds read the live `topics` table at query time, so they reflect the
  new slug automatically (no stored slug).

### Evidence Against / Gaps
- `smart_collections` `contains` (substring) and ordering (`gt`/`lt`) topic predicates
  are DELIBERATELY not remapped (`smart-collections.ts:409-412` doc). A `topic
  contains <oldslug-substr>` filter silently stops matching after a rename. Documented
  intentional (a substring filter is not an identity reference), not a defect.
- `audit_log.target_id` historical rows keep the old slug; correctly NOT re-pointed
  (audit history must be immutable).

### Verdict: **CLEARED** (high confidence)
No orphan / no CASCADE data-loss on rename. The `contains`-predicate non-remap is a
documented intentional limitation, not a bug.

---

## Flow 2 — Upload quota tracker: phantom claim or quota bypass?

### Observation
`uploadImages` pre-claims quota (`tracker.bytes += totalSize; tracker.count +=
files.length`, `images.ts:226-228`) BEFORE any await, then settles the claim against
actual successes on every exit (`settleUploadTrackerClaim`).

### Hypothesis
A path between claim and settle leaves a phantom claim (over-count → legit upload
rejected) OR under-counts (bypass).

### Trace — every exit after the claim (line 228)
| Exit | Settled? | Line |
|------|----------|------|
| disk pre-check `< 1GB` | ✓ settle(…,0,0) | 244 |
| disk `statfs`/`ensureDirs` throw | ✓ try/catch → settle(…,0,0) | 247-250 |
| topic not found (`!topicRow`) | ✓ settle(…,0,0) | 261 |
| all-failed (`successCount===0`) | ✓ settle(…,0,0) | 513 |
| success / partial path | ✓ settle(…,success,bytes) | 535 |
| per-file throw | caught per-file (try 281-504), loop continues | — |
| **topic-exists `db.select` THROWS** | **✗ no try/catch** | **256-259** |

- Claim is made synchronously after all SYNC quota checks (R16C16 CR-16-01), closing
  the check-then-claim TOCTOU. Concurrent same-key uploads can't bypass (claim before
  first await). Settle math (`upload-tracker.ts:30-31`) reconciles DOWN by the failed
  portion → no under-count / bypass on any path.
- The disk-check block (`images.ts:233-251`) is wrapped in try/catch that settles on
  throw. The very next awaited statement — the topic-exists `db.select`
  (`images.ts:256`) — is **NOT** wrapped. If it rejects (pool timeout, conn reset,
  server restart mid-deploy), the exception escapes `uploadImages`; the only enclosing
  handler is the contract-lock `finally` (`images.ts:561-563`) which releases the lock
  but does **not** settle the tracker. The claim (`count += files.length`,
  `bytes += totalSize`) persists.

### Evidence For (defect exists)
- No try/catch around `images.ts:256-259`; `db.select` can reject; the escaping
  rejection bypasses every `settleUploadTrackerClaim` call.
- Textbook "fix one sibling, miss the next": the disk check immediately above got
  try/catch+settle; the topic select immediately below did not.

### Evidence Against (severity-limiting)
- The phantom claim is per-`userId:ip` and self-heals: window auto-resets after 1 h
  (`resetUploadTrackerWindowIfExpired`, `upload-tracker-state.ts:62-68`), prune drops
  it after 2 h (`pruneUploadTracker:39`). Bounded blast radius (one admin+IP, ≤1 h).
- Requires a DB error precisely on the topic-exists SELECT — uncommon, infra-driven,
  not attacker-triggerable (the topic value is already validated).

### Verdict: **CONFIRMED DEFECT (low severity)**
Phantom upload-quota claim leaks when the topic-exists `db.select` at
**`apps/web/src/app/actions/images.ts:256`** throws. Over-counts the per-window quota
(can reject later legit uploads from the same admin+IP) until the 1 h window resets.
No under-count / bypass on any path. Fix: wrap 256-259 in try/catch and
`settleUploadTrackerClaim(…,0,0)` on error before rethrow/return, mirroring the
disk-check block at 247-251.

---

## Flow 3 — Numeric guards: does a NaN/Infinity slip a size/limit/coord comparison?

### Observation
Multiple `Number()/parseInt/parseFloat` results feed `> MAX` / `< MIN` / range
comparisons.

### Trace — every coercion-into-comparison site
| Site | Guard | Verdict |
|------|-------|---------|
| `og-photo-fetch.ts:62-63` Content-Length | `Number.isFinite(len) && len > MAX` (DBG-16-02) | ✓ guarded |
| `search/semantic/route.ts:136-143` Content-Length | `!Number.isFinite(n) \|\| n < 0` then `> MAX` | ✓ guarded |
| `search/semantic/route.ts:88-91` `clampSemanticTopK` | `typeof !== 'number'` reject + `Number.isFinite` | ✓ guarded |
| `search/similar/[id]/route.ts:74-79` id | regex `^\d+$` then `Number.isFinite(id) \|\| id<=0` | ✓ guarded |
| `image-types.ts:118-119` exposure normalize | `if (!Number.isFinite(val)) return String(...)` | ✓ guarded |
| `process-image.ts:1455,1461,1466-77` GPS DMS→DD | per-component `Number.isFinite` + range (`Math.abs(dd) > maxDegrees`→null) | ✓ guarded (lat ±90, lon ±180, Inf→null) |
| `gallery-config-shared.ts:181,189,229,296` | `Number.isInteger(n) && n>=… && n<=…` | ✓ guarded |
| `data.ts:798,1422` cursor offset | `Math.floor(Number(x)) \|\| 0` (NaN falsy→0) | ✓ safe |
| `exif-datetime.ts:39-45` date parts | regex pre-match + `isValidExifDateTimeParts` | ✓ guarded |
| `validation.ts:181` `safeInsertId` | BigInt range check before `Number()` | ✓ guarded |

### Evidence For / Against
- The previously-flagged `og-photo-fetch.ts` NaN slip (DBG-16-02) is FIXED at line 63
  (`Number.isFinite(len) && len > OG_PHOTO_MAX_BYTES`); the post-buffer cap (66) is a
  second backstop.
- GPS: `convertDMSToDD` rejects non-finite components, out-of-range DMS, and final
  `!Number.isFinite(dd) || Math.abs(dd) > maxDegrees` → null. Infinity and >90/>180
  both → SQL NULL. Locked by the R16C16 GPS Infinity/range test.
- No site found where a bare `Number()` feeds `> MAX` without a finite guard.

### Verdict: **CLEARED** (high confidence)
Every size/limit/coordinate comparison is preceded by `Number.isFinite` /
`Number.isInteger` / regex narrowing, or relies on the NaN-falsy `|| 0` idiom. No
class-(A) slip remaining.

---

## Flow 4 — Migration: does 0024_drop_reactions trigger reconcile on a baselined
prod DB, or no-op?

### Observation
`prepareLegacyDatabaseIfNeeded` returns early when `journalCovered === true`
(`migrate.js:710-715`); the executable drop of `image_reactions` lives in
`reconcileLegacySchema` (`migrate.js:638-639`), which only runs when journalCovered
is false.

### Hypothesis
On an already-baselined prod DB the new entry is a no-op, so the dead reactions
schema persists forever.

### Trace
- `journalCovered = migrations.every(m => haveHashes.has(m.hash))` (`migrate.js:710`).
- `0024_drop_reactions` is journal idx 24, `when = 1782100000000` (2026-06-22),
  strictly greater than 0023's `1782000000000` (verified via `_journal.json` dump) —
  monotonic at the top, so it does not poison the MAX(created_at) cursor.
- Its hash = SHA256 of `drizzle/0024_drop_reactions.sql`. On a prod DB baselined at
  cycle ≤16, that hash is NOT in `__drizzle_migrations` → `journalCovered === false`
  → falls through to `reconcileLegacySchema` (`migrate.js:721`).
- Reconcile runs `dropTableIfPresent('image_reactions')` +
  `dropColumnIfPresent(…,'images','reaction_count')` (638-639), both
  INFORMATION_SCHEMA-guarded idempotent (215-228). The table+column created by
  `0007_image_reactions.sql` (verified present) are dropped here.
- Then `baselineAllJournalMigrations` inserts the 0024 hash (722); `runMigrations`→
  drizzle `migrate()` sees the hash present and the cursor at 0024's own `when`, so
  `0024.sql`'s bare DDL is a verified no-op (baselined-not-run). Post-condition
  (`runMigrations:735-745`) passes (all hashes recorded).

### Evidence For (cleared)
- The new journal entry is precisely the missing TRIGGER that flips journalCovered to
  false; the drop executor is reconcile, which now runs. Confirmed by reading the full
  decision path, journal monotonicity, and 0007/0024 SQL contents.

### Evidence Against / Gaps
- On the SECOND+ deploy after 0024 ships, journalCovered becomes true again (hash now
  recorded) and reconcile is skipped — but the drop already ran on the first deploy
  and is idempotent. No re-drop needed. No defect.

### Verdict: **CLEARED** (high confidence)
Hypothesis REFUTED. `0024_drop_reactions` flips `journalCovered === false` on the
first deploy of any already-baselined DB, forcing `reconcileLegacySchema` to execute
the guarded `image_reactions` / `reaction_count` drop. It does NOT no-op on prod.

---

## Flow 5 — Color pipeline admin-only columns: leak to public DOM?

### Observation
Ten color columns are admin-only (`color_pipeline_decision, is_hdr, has_gain_map,
was_downscaled, transfer_function, matrix_coefficients, bit_depth, color_space,
icc_profile_name, pipeline_version`); two are public (`color_primaries, avif_10bit`).

### Hypothesis
An admin-only column reaches the public DOM.

### Trace — three independent layers
1. **Data layer**: `publicSelectFields` (`data.ts:395`) is destructure-OMIT-derived
   from `adminSelectFields`; all ten admin-only color keys are in the omit list
   (`data.ts:373-391`). Compile-time guard `_privacyGuard`
   (`_SensitiveKeysInPublic extends never`, `data.ts:463-465`) fails `tsc` if any
   sensitive key reappears; runtime test `privacy-fields.test.ts` SENSITIVE_KEYS
   fixture pins the same set (color_pipeline_decision/transfer_function/… at lines
   14,16).
2. **Fetch layer**: the ONLY viewer fetch, `getImage` (`data.ts:1004-1013`), spreads
   `...publicSelectFields` with NO isAdmin branch. Grep confirms **zero** `.select`
   spreads `adminSelectFields` anywhere in `src/` — the admin-only color columns are
   never SELECTed for any UI surface (the only other selects of `transfer_function`
   are `image-queue.ts:722` and `retryFailedImage` `images.ts:1124`, both internal
   re-encode paths, not UI).
3. **Render layer**: every admin-only render site gates on `isAdmin` —
   `color-details-section.tsx:412` (transfer), `:459` (matrix), `:468` (color_space),
   `:481` (bit_depth), `:491` (was_downscaled), `:570` (HDR badge), `:594` (gain map),
   `:240` (icc name), `:284-291` (clipboard); mirrored in `lightbox-color-pip.tsx:50,
   83,179,196,202,263-265` and `photo-viewer.tsx:890,902,961`. The public page
   `p/[id]/page.tsx:148,283` resolves `isAdmin()` server-side and passes the real flag.

### Evidence For (cleared)
- Triple defense: omit (compile-guard + test) → not fetched (getImage uses
  publicSelectFields) → isAdmin-gated at render. A public visitor's `image` object
  literally lacks these keys (undefined), and the render condition would be false
  anyway.

### Evidence Against / Gaps
- Consequence of layer 2: because `getImage` uses `publicSelectFields` even for
  logged-in admins, the admin-gated color/GPS rows on the PUBLIC `/p/[id]` page are
  effectively dormant (data not fetched, so `isAdmin && image.transfer_function` is
  `true && undefined`). No admin route renders `ColorDetailsSection` (grep of
  `app/[locale]/admin` = empty). This is a design/honesty choice (WI-09-deferred
  foundation columns), NOT a privacy leak. NEEDS-MANUAL-CHECK only if admins are
  EXPECTED to see the color audit on the public photo page.

### Verdict: **CLEARED** (high confidence)
No admin-only color column reaches the public DOM. Hypothesis REFUTED.

---

## Summary table
| Flow | Verdict | Confidence |
|------|---------|-----------|
| 1 Topic slug rename | CLEARED (contains-predicate non-remap intentional) | High |
| 2 Upload quota tracker | **CONFIRMED DEFECT (low sev)** — `images.ts:256` unguarded select | High (path), Low (impact) |
| 3 Numeric guards | CLEARED | High |
| 4 Migration 0024 reconcile trigger | CLEARED (hypothesis refuted) | High |
| 5 Color admin-only → public DOM | CLEARED | High |

## Critical Unknown
Whether `db.select` at `apps/web/src/app/actions/images.ts:256` can realistically
reject in production frequently enough to matter (infra-dependent), and whether the
ColorDetailsSection admin audit on the public `/p/[id]` page is intended to be dormant
(Flow 5 secondary note).

## Discriminating Probe
For Flow 2: add a unit test that stubs the topic-exists `db.select` to reject AFTER
the claim, then assert `getUploadTracker().get(key)` still carries the inflated
count/bytes (proves the leak); then wrap 256-259 in try/catch+settle and assert the
tracker rolled back to 0. This single test confirms the defect and locks the fix.

## Uncertainty Notes
- Flow 2 impact is bounded/self-healing (≤1 h) and not attacker-triggerable; severity
  is LOW but the code path is unambiguous.
- Flow 1 `contains`-predicate and Flow 5 dormant-admin-audit are documented/intentional
  behaviors, surfaced for awareness, not filed as defects.
