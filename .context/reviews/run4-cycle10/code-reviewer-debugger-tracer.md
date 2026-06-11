# Code-reviewer / Debugger / Tracer — Run-4 Cycle 10

Angle: line-level correctness + failure-mode tracing, prioritizing the two
empirically-proven defects and an independent regression trace of the five
cycle-9 fix commits.

## Inventory
- `lib/gps-exif-strip.ts` full (the JPEG segment walker is the trace target).
- `lib/process-image.ts` `stripGpsFromOriginal` tier dispatch (1486-1545).
- `app/actions/admin-users.ts` `deleteAdminUser` (179-275),
  `app/actions/auth.ts` `login` audit-write call site (198).
- `lib/data-timeline.ts`, `lib/data.ts` privacy-mirror guards.
- `lib/locale-path.ts`, `lib/revalidation.ts`, `lib/photo-title.ts`,
  `lib/storage/local.ts`, `lib/upload-paths.ts`, `lib/session.ts`,
  `lib/audit.ts` (read clean).
- Pattern sweeps: unguarded `JSON.parse` (all 5 sites guarded — wide-gamut
  hint, admin-tokens, smart-collections, semantic route all validate /
  try-catch), `parseInt` radix (no missing-radix sites), server timers
  (`data.ts` view-flush + `image-queue.ts` gc/bootstrap all tracked with
  clear/unref), `new Date()` in components (only OnThisDay — known DEF-R4C9-A).

## COR-R4C10-01 — `deleteAdminUser` blocked by audit FK (MED/High)
Root-cause trace (see security file for the live repro):
`auth.ts:198` writes `audit_log(user_id=<self>, action='login_success')` on
every login. The FK `audit_log_user_id_admin_users_id_fk` is `ON DELETE NO
ACTION`. `deleteAdminUser` (admin-users.ts:243-247) deletes `sessions` then
`admin_users` but never touches `audit_log`, so the parent-row delete throws
errno 1451 → caught at 256-268 → generic `failedToDeleteUser`. The advisory
lock and last-admin guard are all sound; the bug is the missing audit
detach. Fix: `UPDATE audit_log SET user_id = NULL WHERE user_id = ?` inside
the locked transaction before the admin delete (column is nullable).

## SEC-R4C10-01 — JPEG post-EOI trailer GPS leak (MED/High)
Trace (see security file for the proof): `stripGpsFromJpegBuffer` segment
loop `break`s at the first `0xda`/`0xd9` (line 226), so trailer segments are
never walked; the rebuild path (295-312) only drops std/ext XMP segments it
found in the primary, copying the trailer verbatim via the final
`parts.push(buf.subarray(cursor))`. Returns `stripped:true` → caller writes
the leaky bytes instead of taking the safe tier-2 re-encode. Fix: detect the
trailer (first `FF D9` from the scan region; `FF D9` is impossible inside
valid entropy data, so `indexOf` is exact) and return `null` so
`stripGpsFromOriginal` re-encodes the primary and drops the trailer.

## Regression trace of cycle-9 commits — all SOUND
- `edac55f4`: ext-XMP read bounds correct (guard `data.length > SIG+40`
  dominates the `readUInt32BE(SIG+36)` at offset 71-74). Joined
  reconstruction sorts by declared offset and only runs for >1 chunk.
- `3adbd2d4`: timeline guard imports the single exported `PrivacySensitiveKeys`
  union; no copy. `color_space`/`bit_depth` removed; `timelineSelectFieldKeys`
  exported for the fixture.
- `a46b8ca3`: OnThisDay now routes the base JPEG through `OptimisticImage`
  (next/image optimizer) — source stays the guaranteed base filename
  (R20-M2), `sizes="48px"` keeps the variant small. Sound.
- `d676e1aa`: SW `startRevalidate` single-flight closure; 304 path calls
  `touchMeta` (no body fetch); `isSensitiveResponse` still gates the lazy
  fetch. Sound.

## LOW observations (deferred ledger)
- **COR-R4C10-LOW-B** — `stripGpsFromOriginal` tier routing still trusts the
  user-supplied extension (carried from DEF-R4C9-B; unchanged this cycle).
- **DES/COR-R4C10-LOW-C** — OnThisDay "today" remains server-TZ (carried
  DEF-R4C9-A).
