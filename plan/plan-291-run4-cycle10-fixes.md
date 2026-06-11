# Plan 291 — Run-4 Cycle 10 fixes

**Source review:** `.context/reviews/run4-cycle10/_aggregate.md`

Two empirically-proven MED findings this cycle, both non-deferrable
(privacy + correctness). Deferred LOW observations are recorded in
`plan/plan-292-run4-cycle10-deferred.md`.

Repo policy binding: GPG-signed commits (`-S`), Conventional Commits +
gitmoji, `git pull --rebase` before push, no `--no-verify`, Node 24 / TS 6.
All gates green before deploy (DEPLOY_MODE per-cycle).

---

## Task 1 — SEC-R4C10-01: scrub GPS hidden in a post-EOI JPEG trailer

**Status:** ✅ DONE — commit `208a8c7e`

**File:** `apps/web/src/lib/gps-exif-strip.ts` `stripGpsFromJpegBuffer`.

**Problem (proven):** the segment walker `break`s at the first SOS/EOI
(line 226), so a JPEG carrying a post-EOI trailer — a second full
`FFD8…FFD9` image (MPF secondary, Samsung / Pixel Motion Photo) — keeps
that trailer verbatim in the rewritten output. If the trailer's embedded
image carries its own EXIF GPS IFD or GPS XMP, the coordinates survive while
the function returns `{stripped:true}`. Empirically: trailer GPSLatitude=37
SURVIVED. The caller's safe tier-2 re-encode never fires because it only
triggers on a `null` return.

**Fix:** after the segment walk, locate the primary image's terminal EOI
(first `FF D9` scanning from the start of the first scan/SOS region — `FF D9`
cannot occur inside valid entropy-coded scan data, so `Buffer.indexOf` is
exact). If a non-trivial trailer follows (more than a couple of padding
bytes), return `null` so `stripGpsFromOriginal` routes the file to the
guaranteed-safe tier-2 Sharp re-encode (decodes the primary still, drops the
trailer entirely). Update the module docblock to state the trailer handling.

**Tests** (`__tests__/strip-gps-from-original.test.ts` or the jpeg-buffer
suite):
1. Proven-failing-before: primary-GPS + trailer-GPS JPEG → returns `null`
   (so the caller re-encodes and no GPS survives).
2. Trailer-without-GPS JPEG → still returns `null` (safe re-encode; correct
   because the lossless path can't certify the trailer).
3. Single-image JPEG (no trailer) → unchanged lossless tier-1 behavior
   (`stripped:true` with byte-identical non-GPS regions, or `stripped:false`
   when clean).

---

## Task 2 — COR-R4C10-01: let `deleteAdminUser` detach audit rows

**Status:** ✅ DONE — commit `a5455047`

**File:** `apps/web/src/app/actions/admin-users.ts` `deleteAdminUser`.

**Problem (proven against live MySQL 8):** every `login_success` writes
`audit_log(user_id=self)`; the FK `audit_log_user_id_admin_users_id_fk` is
`ON DELETE NO ACTION`; the delete transaction removes `sessions` then
`admin_users` but never `audit_log` → errno 1451 → generic
`failedToDeleteUser`. Any admin who has logged in within the 90-day audit
window cannot be deleted.

**Fix:** inside the existing advisory-locked transaction, before
`DELETE FROM admin_users`, run
`UPDATE audit_log SET user_id = NULL WHERE user_id = ?` (parameterized raw
`conn.query`, consistent with the surrounding raw SQL). The column is already
nullable; this detaches the actor linkage exactly as `ON DELETE SET NULL`
would (mirroring the `uploaded_by` FK precedent), preserving the audit event
records. No schema migration. Add a code comment documenting the detach so a
future refactor can't drop it.

**Test** (`__tests__/` — behavioral): insert admin + an `audit_log` row
referencing them, delete the admin, assert success AND that the audit row
survives with `user_id = NULL`. (If the unit suite cannot reach a live DB,
add the assertion to the e2e admin-users spec instead.)

---

## Gate checklist (PROMPT 3) — ALL GREEN
- [x] eslint — 0 errors / 0 warnings
- [x] typecheck — PASS
- [x] vitest — **1744/1744** (182 files; +5 tests this cycle: 4 GPS-trailer
      cases in `strip-gps-from-original.test.ts` + 1 audit-detach behavioral
      test in `admin-user-delete-audit-detach.test.ts`)
- [x] lint:api-auth — PASS
- [x] lint:action-origin — PASS
- [x] lint:public-route-rate-limit — PASS
- [x] production build — PASS (route table emitted, middleware compiled,
      0 errors; `sw.js` refreshed to `78d2a108-p7` in `4f20df8e`)
- [x] Playwright e2e — **20 passed / 2 skipped** (standing conditional
      skips: authenticated origin-guard CI-only + one configured skip), exit 0

## Commits this cycle
- `208a8c7e` — SEC-R4C10-01 GPS post-EOI trailer fix + tests
- `a5455047` — COR-R4C10-01 audit-detach fix + test
- `78d2a108` — review artifacts + plans
- `4f20df8e` — SW_VERSION refresh

## Deploy (DEPLOY_MODE: per-cycle)
(record appended below after `npm run deploy`)
