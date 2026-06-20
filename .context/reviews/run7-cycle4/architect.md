# Architect Review — run-7 cycle-4

- **HEAD reviewed:** `25bb2794`
- **Delta since cycle-3 reviewed HEAD `c6eff919`:** 2 source files only — `color-detection.ts` (comment-only) + `settings-hash.ts` (the `_ColorKeysAreSettingKeys` guard, AGG-R7C3-02 / my ARCH-R7C3-01 recommendation) — plus review docs and the SW version stamp. Confirmed via `git diff --name-only c6eff919 25bb2794` filtered for non-doc/non-sw: exactly those two files.
- **Scope:** Invariant integrity, ETag/cache-invalidation (settings-hash COLOR_IMPACTING_KEYS guard), config-resolution chain, privacy-field derivation, advisory-lock correctness, backfill concurrency budgeting, migration/schema-drift runbook, race protections.

## Verdict

**0 NEW findings. Converged cycle — truthful zero.**

The only source-behavioral change in this delta is a compile-time-only type guard (my own prior recommendation) plus a comment correction. Every other architectural surface is byte-identical to the cycle-3 reviewed/converged HEAD `c6eff919`, so no regression is possible by construction. I did a fresh-eyes pass on the genuinely-new guard and on the completeness of the invariant it protects; both are correct. No speculative refactors manufactured.

## ARCH-R7C3-01 guard verification (my prior recommendation — landed correctly)

Commit `33ec5b30` (AGG-R7C3-02). Verified at `apps/web/src/lib/settings-hash.ts:56-66`:

```ts
type _ColorKeysAreSettingKeys =
    (typeof COLOR_IMPACTING_KEYS)[number] extends GallerySettingKey ? true : never;
const _colorKeysAreSettingKeys: _ColorKeysAreSettingKeys = true;
void _colorKeysAreSettingKeys;
```

Correctness checks performed:
1. **Type source is canonical.** `GallerySettingKey` is imported (`type`-only) from `gallery-config-shared.ts:73` = `typeof GALLERY_SETTING_KEYS[number]` (`settings-hash.ts:40`). The guard is tied to the single authoritative tuple, not a duplicate.
2. **Guard semantics are sound.** If any `COLOR_IMPACTING_KEY` were typo'd or removed from `GALLERY_SETTING_KEYS`, the conditional resolves to `never`, and `const _colorKeysAreSettingKeys: never = true` is a hard `tsc` error. Mutation-reasoned: drift IS caught.
3. **No lint/runtime noise.** `void`-discarded const → no unused-var lint; compile-time only; zero runtime change.
4. **All 9 keys are genuinely valid.** Cross-checked `COLOR_IMPACTING_KEYS` (`settings-hash.ts:42-54`) against `GALLERY_SETTING_KEYS` (`gallery-config-shared.ts:25-71`): `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes` — all present. Guard is satisfied today.
5. **`buildHashFromConfig` covers all 9 keys** (`settings-hash.ts:89-101`) — config-arg path and DB path both hash the identical key set; no asymmetry.
6. **Documented honest bound is accurate.** The guard CANNOT catch a *forgotten new* byte-impacting setting (a valid key is still a valid key); that residual gap is correctly delegated to the CLAUDE.md "Adding a new color-impacting setting" checklist (`settings-hash.ts:56-62` comment + CLAUDE.md ETag section). This is exactly the bound I stated last cycle.

Evidence the guard compiles and is locked:
- `tsc -p tsconfig.typecheck.json`: **0 source-level errors** (only two pre-existing `TS6053` for missing `.next/types/cache-life.d.ts` + `validator.ts` build artifacts — unrelated to source, present because the build hasn't been run in this checkout).
- `vitest run src/__tests__/settings-hash.test.ts`: **15/15 passed** (matches the commit-message claim).

## Completeness of the protected invariant (the real risk class)

The guard protects against key-drift; the orthogonal risk is a byte-impacting setting MISSING from the list. Audited every member of `GALLERY_SETTING_KEYS` not in `COLOR_IMPACTING_KEYS`:
- `strip_gps_on_upload` — mutates the ORIGINAL on disk, not derivative bytes → correctly excluded.
- `allow_hdr_ingest` — an ingest GATE (rejects PQ/HLG at upload, `gallery-config.ts:159-161`); does not alter the encoded bytes of an already-accepted image → correctly excluded.
- `slideshow_interval_seconds`, `auto_alt_text_enabled`, `semantic_search_mode`, `license_price_*`, `force_show_color_chips` — UI / metadata / search / pricing, no derivative-byte effect → correctly excluded.

`COLOR_IMPACTING_KEYS` is complete and correct for the current setting surface. No missing byte-impacting key.

## color-detection.ts delta (comment-only — verified)

`git diff c6eff919 25bb2794 -- src/lib/color-detection.ts`: the `NCLX_TRANSFER_MAP` VALUES are unchanged (`11: 'srgb'`, `14/15: 'gamma24'`); only the explanatory comments were corrected (xvYCC uses the BT.709 transfer curve, not the sRGB IEC-61966-2-1 curve; BT.2020-NCL is the *matrix* name not the *transfer* name). Matches AGG-R7C3-01. No runtime/behavioral change. No finding.

## Spot-checks on unchanged surfaces (re-verified, no new evidence)

- **Backfill concurrency budgeting** (`admin-backfill-runner.ts:105,120-122,129-138`): `cap = floor((LIMIT−RESERVED−1)/2)` with `RESERVED = max(3, ceil(LIMIT/2))` → at LIMIT=10, RESERVED=5, cap=2. Internally consistent and exactly matches CLAUDE.md. Byte-identical to cycle-3.
- **Advisory-lock registry** (`advisory-locks.ts:19-44`): all 6 names (`db_restore`, `upload_processing_contract`, `topic_route_segments`, `admin_delete`, `image-processing:{jobId}`, `color_pipeline_backfill`) intact. Byte-identical to cycle-3. (Server-scoped multi-tenant caveat already documented; INFO-R7C2-09 separator already adjudicated cosmetic — not re-raised.)
- **Privacy-field derivation** (`data.ts:204-318`): `adminSelectFields` → destructured-omit → `publicSelectFields`, with `_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` compile-time guards intact. Byte-identical to cycle-3.

## Re-verified adjudicated items (unchanged, NOT re-raised)

Per cycle-4 directive, the following remain DEFERRED/adjudicated with no new evidence and no met exit criterion this cycle — re-confirmed unchanged, not re-filed:
- ARCH-R7C2-01 (charge.refunded gap) — bundle with plan-316.
- OBS-R7C2-02..07 (reconcile-position backfill, non-transactional restore, failRestore temp leak, pool not .end()'d, unbounded bootstrap retry, updateTopic no FOR UPDATE) — documented-design / operator-mitigated deferrals.
- INFO-R7C2-08 (orphan migration 0014), INFO-R7C2-09 (lock-name separator) — cosmetic.
- REJ-R7C3-01 (indexSize) — disproved. MED-R7C2-01 (histogram) — refuted. Not re-filed.

## Summary table

| ID | Severity | Status |
|----|----------|--------|
| (none) | — | 0 new findings — converged cycle |

The guard I recommended last cycle (ARCH-R7C3-01 → AGG-R7C3-02, `33ec5b30`) landed correctly, compiles, is complete, and is locked by 15/15 settings-hash tests. Nothing new is broken.
