# Security / Critic / Verifier — Run-4 Cycle 10

Angle: OWASP-style review of the GPS-strip privacy parser (the youngest
privacy-critical code, extended again in cycle 9), auth/session stack,
SQL-restore scanner, OG routes, CSP, FK delete invariants. Plus an
adversarial-container empirical experiment that converted a hypothesis
into a proven privacy defect.

## Inventory (full reads this cycle)
- `lib/gps-exif-strip.ts` (555 lines — JPEG/TIFF/ISOBMFF/WebP byte surgery)
  and its caller `lib/process-image.ts` `stripGpsFromOriginal` tier dispatch
  (lines 1486-1540).
- Auth: `app/actions/auth.ts`, `app/actions/admin-users.ts`, `lib/session.ts`,
  `lib/action-guards.ts`, `lib/password-hashing.ts`.
- Restore: `lib/sql-restore-scan.ts`, `lib/db-restore.ts`.
- OG routes: `api/og/route.tsx`, `api/og/photo/[id]/route.tsx`.
- CSP: `lib/content-security-policy.ts`, `lib/csp-nonce.ts`, `proxy.ts`;
  LIVE production header probe of `https://gallery.atik.kr/en`.
- Schema FK delete rules (`db/schema.ts`) + LIVE MySQL 8 probe against the
  running `gk-e2e-mysql` container.

## SEC-R4C10-01 — GPS in a post-EOI JPEG trailer survives `stripGpsFromJpegBuffer` (MED / High, empirically proven)

**Where:** `apps/web/src/lib/gps-exif-strip.ts` `stripGpsFromJpegBuffer`,
the segment-walk loop at lines 218-242. Specifically line 226:

```js
if (marker === 0xda || marker === 0xd9) break; // SOS / EOI — no metadata beyond
```

**The defect:** the walker stops at the FIRST `SOS`/`EOI` marker, so it only
ever inspects the segments of the **primary** image. A JPEG that carries a
**post-EOI trailer** — a second full `FFD8…FFD9` image (MPF / Multi-Picture
Format secondary, or a Samsung / Google Pixel "Motion Photo", or an
appended container) — keeps that trailer **verbatim** in the rewritten
output. If the trailer's embedded image carries its own EXIF GPS IFD (tag
`0x8825`) or GPS XMP, those coordinates are **not** scrubbed, yet the
function returns `{ stripped: true }` (because the primary's GPS WAS zeroed).

**Why the safety net does not catch it:** `stripGpsFromOriginal`
(process-image.ts:1514-1520) only falls back to the guaranteed-safe tier-2
re-encode when the scrubber returns **`null`** (structural anomaly). Sharp's
re-encode decodes only the primary still and drops every trailer, so tier-2
WOULD be safe — but it never runs, because the trailer case returns
`stripped:true`, not `null`. The leak therefore lands in the **stored
original**, which is exactly the byte stream the paid-download endpoint
(`api/download/[imageId]`) streams verbatim. Public gallery + DB columns are
already GPS-free (nulled at ingest), so this is download-original-only — same
blast radius as SEC-R4C9-01.

**Empirical proof (vitest harness against the real exported function):**
constructed a JPEG = `[primary JPEG with EXIF GPS][second full JPEG with EXIF
GPS]`, ran the real `stripGpsFromJpegBuffer`:

```
stripped flag: true
Exif signatures found in output: 2 [6, 79]
  TIFF@12: GPSLatitude numerator = 0   (zeroed — primary)
  TIFF@85: GPSLatitude numerator = 37  (SURVIVED — LEAK — trailer)
```

The trailer's GPSLatitude (37) is carried through unmodified while the
function reports success.

**Realism:** post-EOI trailers are not exotic — every Samsung Motion Photo,
Google Pixel Motion Photo, and MPF multi-image JPEG (Fujifilm, Sony,
Apple-exported burst/depth) appends a secondary image (and often a video)
after the primary EOI, and these are precisely the GPS-rich files a
photographer ingests. Triggered only when `strip_gps_on_upload` is ON
(admin opt-in, default OFF) — hence MED not HIGH.

**Fix (privacy-first, matches the tier contract):** detect a non-trivial
trailer after the primary image's terminal EOI (locate the first `FF D9`
from the scan region — `FF D9` cannot occur inside valid entropy-coded scan
data, so `indexOf` is reliable) and return **`null`** so tier-2 re-encode
strips the trailer entirely. Cost: motion-photo / MPF uploads get a q95
re-encode of the primary and lose the hidden trailer — which, when GPS-strip
is ON, is the privacy-correct outcome (you do not want to ship an opaque
secondary image or video that may carry coordinates). Lock with a
proven-failing-before behavioral test (the probe above) plus a "trailer
without GPS still routes to safe handling" case.

**Cross-angle agreement:** code (segment-walk `break` trace), verifier
(empirical repro above), test (suite has zero post-EOI fixtures — all
existing XMP/EXIF cases are single-image).

## Regression review of cycle-9 commits (SOUND)

Re-reviewed all five fix commits at line level:

- `edac55f4` ExtendedXMP scrub: the offset read `data.readUInt32BE(SIG+36)`
  (offset 71-74) is correctly guarded by `if (data.length > SIG+40)` (>75),
  so the 4-byte read cannot overflow. The per-chunk token test + the
  offset-ordered joined reconstruction (only when `extXmpChunks.length > 1`)
  close the split-token gap. The drop-pass at 295-312 drops BOTH std and ext
  XMP segments. Sound.
- `3adbd2d4` timeline privacy guard: `data-timeline.ts` now imports
  `PrivacySensitiveKeys` from data.ts and applies the identical `Extract`
  guard; `color_space`/`bit_depth` removed from `timelineSelectFields`.
  Verified the union is exported once and reused (no copy drift). Sound.
- `d676e1aa` SW lazy revalidate, `a46b8ca3` OnThisDay OptimisticImage: no
  security surface; reviewed for sensitive-response handling
  (`isSensitiveResponse` still gates the lazy fetch). Sound.

## Re-verified clean (no new findings)
- **Auth timing:** `login` verifies Argon2 against a dummy hash on missing
  user (constant-time enumeration defense intact); rate-limit pre-increment
  precedes the verify (TOCTOU closed); validation precedes increment so
  typos don't burn budget. `PASSWORD_HASH_OPTIONS` shared across login /
  change / create / seed.
- **Session:** HMAC verified with `timingSafeEqual` after length guard;
  `SESSION_SECRET` refuses DB fallback in production.
- **SQL restore scanner:** dangerous-pattern set still covers GRANT/REVOKE/
  DROP/CALL/HANDLER/DO/PREPARE/DEFINER routines after comment+literal
  stripping; app-backup DROP TABLE allowlist masked before the scan.
- **OG routes:** both rate-limited (30/60s/IP), `sanitizeForOg` strips bidi
  + C0; per-photo route rolls back the attempt on every early return.
- **CSP:** live prod header carries a per-request `'nonce-…'`, `object-src
  'none'`, `frame-ancestors 'self'`, `base-uri 'self'`. No `unsafe-inline`
  in script-src in production.

## COR-R4C10-01 — `deleteAdminUser` cannot delete any admin who has ever logged in (MED / High, empirically proven against live MySQL 8)

**Where:** `apps/web/src/app/actions/admin-users.ts` `deleteAdminUser`
(lines 243-247) + the FK `audit_log_user_id_admin_users_id_fk`
(`db/schema.ts:170`, `drizzle/0001_sync_current_schema.sql:69`).

**The defect:** the FK is `ON DELETE NO ACTION` (confirmed via
`information_schema.REFERENTIAL_CONSTRAINTS` on the running `gk-e2e-mysql`).
Every successful login writes an audit row referencing the logging-in
admin's own id — `auth.ts:198`:
`await logAuditEvent(user.id, 'login_success', 'user', String(user.id), ip)`.
So any admin who has logged in within the 90-day audit-retention window has
≥1 `audit_log` row with `user_id = <their id>`. `deleteAdminUser` deletes
the target's `sessions` then runs `DELETE FROM admin_users WHERE id = ?` —
which the FK **rejects with errno 1451**, rolled back to the generic
`failedToDeleteUser` toast. The documented "delete admin user" feature is
therefore **effectively broken for every active co-admin**; only an admin
who has never logged in (and never been an audit actor) can be removed.

**Empirical proof (live MySQL 8, exact `deleteAdminUser` sequence):**
```
INSERT admin_users(username) → uid
INSERT audit_log(user_id=uid, action='login_success')
DELETE FROM sessions WHERE user_id = uid       -- ok
DELETE FROM admin_users WHERE id = uid
  → ERROR 1451 (23000): Cannot delete or update a parent row:
    a foreign key constraint fails (`audit_log`, CONSTRAINT
    `audit_log_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`)
    REFERENCES `admin_users`(`id`))
```

**Severity:** MED. Fails closed (no data loss, no lockout-of-last-admin
bypass, no security hole — the admin is simply not removed), but the
feature is non-functional for the common case and the error message is
misleading. High confidence (reproduced against the real schema).

**Fix (migration-free, atomic, matches the nullable column):**
`audit_log.user_id` is already nullable (`int`, Null=YES). Inside the
existing advisory-locked transaction, before the `admin_users` delete, run
`UPDATE audit_log SET user_id = NULL WHERE user_id = ?` (parameterized, raw
`conn.query` consistent with the surrounding raw SQL). This detaches the
actor linkage exactly as an `ON DELETE SET NULL` rule would, preserves the
audit event records (action / target_id / ip / created_at all survive, and
`login_success` rows still carry the id in `target_id`), and needs no schema
migration — avoiding the schema-drift runbook's DROP+re-ADD-constraint risk.
Lock with a behavioral test (proven-failing-before: delete an admin with an
audit row).

**Cross-angle agreement:** security/verifier (live repro), code (FK + delete
sequence trace), test (no fixture deletes an admin with audit history),
document (CLAUDE.md "Last admin deletion prevented to avoid lockout" notes
only the last-admin guard, not this broader breakage).

## HARD-SCOPE
No finding proposes edit / culling / scoring / preset features. SEC-R4C10-01
strengthens an existing privacy guarantee on the photographer-deliverable
original.
