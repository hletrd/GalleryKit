# Architect Review — run-7 cycle-6

**HEAD:** 1463f219 · **Baseline:** e855e6ee (converged cycle-5 source HEAD)
**Scope:** cross-cutting systemic architecture sweep
**Verdict:** **0 actionable findings — no regression by construction. Empty source delta confirmed.**

---

## 1. Empty-delta / no-regression-by-construction claim — VERIFIED

```
$ git diff e855e6ee..HEAD -- apps/web/src apps/web/scripts apps/web/drizzle --stat
(no output, exit 0)
```

The three source trees (`apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`) are **byte-identical** to the converged cycle-5 source HEAD. The only changes since `e855e6ee` are:

- `.context/reviews/run7-cycle5/**` (12 review docs — non-source)
- `apps/web/public/sw.js` — diff is **only** the `SW_VERSION` stamp (`2848b394-p7` → `ee2d05ba-p7`), a deterministic `prebuild` regeneration; no SW logic change, and `public/` is outside the three audited source trees.

Commits since baseline are `ee2d05ba` (cycle-5 review docs) + `1463f219` (SW stamp refresh). **No source-logic change exists**, so an architectural regression relative to the converged state is impossible by construction. The claim holds.

A line-level review would stop here. As instructed, I ran a fresh cross-cutting sweep on the converged source to confirm the systemic invariants still hold (they do — this is a positive confirmation, not a search for manufactured findings).

---

## 2. Advisory-lock coverage — COMPLETE

All 6 documented lock names are defined in the central registry (`apps/web/src/lib/advisory-locks.ts:19-44`) and each has a live, non-test `GET_LOCK` call site:

| Lock | Definition | Active call site |
|---|---|---|
| `LOCK_DB_RESTORE` | `advisory-locks.ts:19` | `app/[locale]/admin/db-actions.ts:291` |
| `LOCK_UPLOAD_PROCESSING_CONTRACT` | `advisory-locks.ts:22` | `lib/upload-processing-contract-lock.ts:29` |
| `LOCK_TOPIC_ROUTE_SEGMENTS` | `advisory-locks.ts:25` | `app/actions/topics.ts:68` |
| `LOCK_ADMIN_DELETE` | `advisory-locks.ts:34` | `app/actions/admin-users.ts:218` |
| `LOCK_COLOR_PIPELINE_BACKFILL` | `advisory-locks.ts:44` | `lib/admin-backfill-runner.ts:311` + sidecar `scripts/backfill-color-pipeline.ts:305` |
| `getImageProcessingLockName(jobId)` | `advisory-locks.ts:40` | `lib/image-queue.ts:185` + `lib/admin-backfill-runner.ts:348` |

Systemic correctness note (positive): the backfill runner acquires BOTH the backfill lock (`admin-backfill-runner.ts:311`) AND the per-image processing lock (`:348`), so a re-encode of row N cannot interleave with a fresh upload's queue claim of the same row N — the two cross-row mutators share the `gallerykit:image-processing:{id}` namespace. Every cross-row mutation requiring serialization is locked. No uncovered surface.

## 3. settings-hash COLOR_IMPACTING_KEYS — EXACT MATCH to byte-impacting surface

`COLOR_IMPACTING_KEYS` (`settings-hash.ts:42-54`) = 9 keys. I cross-referenced against the full 18-key `GALLERY_SETTING_KEYS` (`gallery-config-shared.ts:25-71`) and the actual encoder parameter consumption in `processImageFormats` (`process-image.ts:958-973`) via `image-queue.ts:322-351`:

**Byte-impacting (in the set, correctly):** `image_quality_webp/avif/jpeg`, `image_sizes`, `force_srgb_derivatives`, `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `wide_gamut_max_source_pixels` — these are *exactly* the args `image-queue.ts` forwards to `processImageFormats`. 9/9 match.

**NOT byte-impacting (correctly excluded):**
- `strip_gps_on_upload` — scrubs the ON-DISK ORIGINAL only (`stripGpsFromOriginal`, `process-image.ts:1573`), never the served AVIF/WebP/JPEG derivatives, so it does not change derivative bytes on the serve-upload path.
- `allow_hdr_ingest` — an upload ACCEPTANCE gate, not an encode parameter.
- `force_show_color_chips` / `slideshow_interval_seconds` / `auto_alt_text_enabled` / `semantic_search_mode` / `license_price_*` — UI/display/pricing/search behavior; zero effect on derivative bytes.

No byte-impacting setting is missing from the set → no silent stale-derivative serving on the serve-upload path. The compile guard `_ColorKeysAreSettingKeys` (`settings-hash.ts:63-66`) holds (every key is a valid `GallerySettingKey`). The empty source delta independently proves no new byte-impacting setting was introduced this cycle.

## 4. Single-writer topology invariants — INTACT under the documented model

Process-local state (rate-limit buckets, backfill-runner status, restore-maintenance flag, view-count buffer) is documented as single-writer / single-instance and best-effort-by-design. None of it corrupts *data* under the documented single-web-instance topology:
- backfill-runner status is per-process but correctness is fenced by the advisory lock (status surface ≠ correctness surface).
- restore flag (R7C1-CR-01) is a carried, documented design contract.
- view-count buffer is explicitly best-effort approximate analytics (flush-on-SIGTERM).
- rate-limit buckets: login has a DB backup; others are per-process (scale-out concern, explicitly out of scope).

No NEW process-local state was introduced (empty delta). No silent-corruption path under single-writer.

## 5. Check-then-act / TOCTOU — constraint-backed or locked

Spot-confirmed the highest-risk table-wide invariant: admin deletion (`admin-users.ts:218-234`) acquires `GET_LOCK(LOCK_ADMIN_DELETE)` BEFORE the `SELECT COUNT(*)` and holds it through the `beginTransaction`/`DELETE`, so two concurrent deletes of different users cannot both observe ">1 admin" and delete the last two. Other documented TOCTOU paths (createTopic ER_DUP_ENTRY catch, INSERT IGNORE tag creation, per-image conditional UPDATE claim) are unchanged from the converged state.

## 6. Privacy field-omission architecture — INTACT

`publicSelectFields` is derived from `adminSelectFields` by destructuring-omission into a *separate object reference* (`data.ts:208`, `:288-312`). Three compile-time guards using the `extends never ? true : [error-tuple]` pattern remain in place:
- `_privacyGuard` (`data.ts:419`) — no `_PrivacySensitiveKeys` member in `publicSelectFields`.
- `_mapPrivacyGuard` (`data.ts:431`) — map-select variant.
- `_largePayloadGuard` (`data.ts:449`) — no large-payload field in public.

A leaked sensitive field becomes a hard `tsc` failure. No drift.

---

## Carried deferrals (NOT re-filed — no new evidence)

- ARCH-R7C2-01 (charge.refunded webhook gap — bundle with plan-316)
- OBS-R7C2-02..07 (documented design contracts / operator-mitigated)
- R7C1-CR-01 (restore-maintenance process-local)

## Summary

**0 actionable architectural findings.** Empty source delta confirmed (`apps/web/src` + `scripts` + `drizzle` byte-identical to baseline `e855e6ee`); the only diff is the SW version stamp in `public/sw.js`. No-regression-by-construction claim **holds**. All five swept systemic dimensions — advisory-lock coverage, settings-hash key completeness, single-writer invariants, TOCTOU serialization, privacy field-omission — are intact and consistent with the converged cycle-5 state. A truthful zero.
