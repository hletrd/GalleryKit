# Architect Review — Run-9 Cycle-8 Systematic Drift Sweep

**Repo:** GalleryKit · **HEAD:** `4e132b03` · **Charge:** exhaustive schema-derived-list / snapshot / parallel-array drift sweep. READ-ONLY analysis.

## Summary

Exhaustively audited all 7 charged drift surfaces plus 4 adjacent derived-list surfaces, with exact counts and file:line evidence. **The drift sweep is CLEAN: 0 DEFECTS.** Every schema-derived list, settings snapshot, and parallel array is aligned with its source of truth, and the alignment is enforced by compile-time guards and/or tripwire tests on the high-risk surfaces (privacy fields, backup tables, color keys). The 45 drift-locking tests pass. The 3-consecutive-MEDIUM settings-drift bug class (c5/c6/c7) is genuinely exhausted: the two external enqueue paths are now symmetric and the gate invariant is sound. One trivial POLISH item: a stale count in CLAUDE.md prose ("19 privacy fields" — actual code is 20). [NOTE: critic + document-specialist DISPROVED this — CLAUDE.md contains NO "19 privacy fields" claim; the "19" tokens are "React 19" and a "1019-1097" line citation. PHANTOM — not a real finding.]

## Analysis (surface by surface)

### Surface 1 — schema.ts ↔ reconcileLegacySchema (migrate.js): CLEAN
- Tables: 18 in schema.ts (schema.ts:4-302), 18 in reconcileLegacySchema + the __drizzle_migrations bookkeeping table (migrate.js:267-629). Set difference both directions empty.
- images columns: exactly 50 on both sides. schema.ts:19-110 union (CREATE block migrate.js:317-357 ∪ ensureColumn ADDs migrate.js:360-401) is a perfect set match.
- The removed license_tier/entitlements (migration 0023) correctly handled by dropColumnIfPresent/dropTableIfPresent at migrate.js:627-628.

### Surface 2 — COLOR_IMPACTING_KEYS: CLEAN
- settings-hash.ts:42-54 lists 9 keys: 5 color + 3 quality + image_sizes. Matches CLAUDE.md.
- Verified against the full 17-key GALLERY_SETTING_KEYS. The 8 non-listed keys all confirmed non-byte-impacting (strip_gps_on_upload operates on private original only; allow_hdr_ingest is accept/reject; auto_alt_text/semantic_search are DB-only; slideshow/force_show_color_chips are UI-only).

### Surface 3 — Privacy field surfaces: CLEAN (4-way aligned at 20)
- PrivacySensitiveKeys union (data.ts:414): 20 members.
- publicSelectFields destructured omissions (data.ts:323-351): 20, identical set.
- SENSITIVE_KEYS fixture (privacy-fields.test.ts:6-42): 20, identical set.
- Symmetric guard test asserts adminOnly === SENSITIVE_KEYS exactly.

### Surface 4 — APP_BACKUP_TABLES superset: CLEAN
- sql-restore-scan.ts:12-31: 18 tables = exactly the schema set. Tripwire test introspects the live Drizzle schema.

### Surface 5 — 6 advisory locks: CLEAN (symmetric, dedicated connections)
Centralized registry at advisory-locks.ts:19-44. Each verified for dedicated connection + finally-block release.

### Surface 6 — 6 admin processing settings on all enqueue paths: CLEAN (re-confirmed independently)
| Enqueue site | quality+imageSizes? | 6 settings? | Verdict |
|---|---|---|---|
| Browser upload images.ts:440 | yes | yes (:461-466) | ✓ |
| Lightroom lr/upload/route.ts:420 | yes | yes (:444-449, CR-R9C7-01) | ✓ |
| Retry images.ts:1139 | no | no → gate reloads | ✓ correct |
| Claim-retry image-queue.ts:290 | same job by-ref | preserved | ✓ |
| Failure-retry image-queue.ts:510 | same job by-ref | preserved | ✓ |
| Bootstrap image-queue.ts:674 | no | no → gate reloads | ✓ correct |

### Surface 7 — Other derived lists / snapshots: CLEAN
- NCLX maps (color-detection.ts:170-220): match CLAUDE.md + run-7 fixes.
- i18n key parity: en.json = ko.json = 779 leaf keys, zero drift.
- Backfill column sets: both entry points persist identical 10 audit columns.
- sanitizeForOg consumers: all 3 import shared @/lib/og-sanitize.
- view-retention tables: references the 3 Drizzle table objects with viewed_at directly.

## DISPOSITION: 0 DEFECTS + 1 PHANTOM POLISH (disproved by critic/document-specialist). Drift-sweep verdict: CLEAN — c5/c6/c7 settings-drift bug class genuinely exhausted. Expected converged outcome.
