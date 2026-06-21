# Security Review — run-9 cycle-3

**Scope:** Whole-repo skeptical security sweep of GalleryKit (Next.js 16 self-hosted photo gallery) at HEAD `c2d3857a`, with focused regression check on the only production-source change since run-8 convergence (`f63af3b9`): `apps/web/scripts/backfill-cicp-recheck.ts` (onEmpty→onIdle) + 2 new test files.
**Risk Level:** LOW (converged, no new attack surface)
**Reviewer posture:** High bar, anti-padding. A truthful ZERO is the success condition.

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0
- **NEW actionable findings: ZERO**

## Verdict
No new, code-confirmed, actionable security findings. The 3 changed files introduce **no security regression**. The full whole-repo sweep across OWASP Top 10 reconfirms the previously-adjudicated clean state. This is a genuine ZERO, not a deferral.

---

## 1. Changed-file regression check (the 3 run-9 changes)

### `apps/web/scripts/backfill-cicp-recheck.ts` — NO REGRESSION
- The script's own header (line 19) and behavior confirm it is **read-only**: it never writes the DB or filesystem. It re-runs `detectColorSignals` on HEIF/AVIF/HEIC originals and logs flip counts. Manual one-shot diagnostic, not auto-run.
- The diff is purely a **queue-drain correctness fix**: `await queue.onEmpty()` → `await queue.onIdle()` (CR-R9C2-01). p-queue 9.1.2 `onEmpty()` resolves at `size===0` but not `pending===0`, so the prior code raced the summary print against the final ≤concurrency tasks. `onIdle()` waits for both. No security surface: no auth, no untrusted input sink, no new I/O.
- SQL is a **parameterized Drizzle `sql` template** (`WHERE original_format IN ('heif','avif','heic')`) with literal constants only — no injection. The mysql2 tuple-unwrap (lines 69–71) is a correctness guard, not a security concern.
- Path resolution goes through `resolveOriginalUploadPath(row.filename_original)`; `filename_original` is a server-generated UUID-based name from the upload pipeline (never user-controlled on disk per `crypto.randomUUID()` policy), and the script only `fs.access` + `sharp()`-reads it (no write/delete).
- The two new test files (`upload-processing-contract-lock.test.ts`, `upload-tracker-state.test.ts`) are test-only; they raise coverage on existing security-relevant logic (advisory-lock GET_LOCK branches; upload-tracker prune/window/active-claim). No production behavior change.

---

## 2. OWASP Top 10 sweep results

### A01 Broken Access Control — CLEAN
- `lint:api-auth` PASS: both `api/admin/**` routes (`db/download`, `lr/upload`) wrap `withAdminAuth(...)` via the direct variable-export form.
- `lint:action-origin` PASS: all mutating server actions store and early-return on `requireSameOriginAdmin()`; the only `@action-origin-exempt` exports are the 3 public analytics recorders in `public.ts` (recordPhotoView/recordTopicView/recordSharedGroupView), each input-validated + IP rate-limited.
- `withAdminAuth` (`lib/api-auth.ts`): token-scope path verifies `verifyToken` + `tokenHasScope`; cookie path falls back to `isAdmin()`; returns 401 (no auth) / 403 (wrong scope). Defense-in-depth intact.
- Middleware admin guard (`proxy.ts`) + per-action `isAdmin()` re-check unchanged.

### A02 Cryptographic Failures — CLEAN
- No hardcoded secrets in `src/` (regex scan over key/secret/password/token literals ≥16 chars, excluding env/example/test = ZERO hits).
- Argon2id password hashing, HMAC-SHA256 sessions with `timingSafeEqual`, prod `SESSION_SECRET` guard — confirmed clean multiple cycles, unchanged this cycle.

### A03 Injection — CLEAN
- **SQL:** All audited queries use Drizzle parameterization (`eq`, `and`, `inArray`, parameterized `sql` templates). No string-concatenated SQL with untrusted input found.
- **Command:** `db-actions.ts` `spawn('mysqldump'|'mysql', [array args], {env})` — array-args form (no shell), `DB_NAME` is a server env var not user input, credentials via `MYSQL_PWD`/`MYSQL_*` env (not `/proc/cmdline`-leaking `-p` flags), minimal env with `HOME` excluded (blocks `~/.my.cnf` loading). No injection lever.
- **Path:** `serve-upload.ts` + `db/download/route.ts` both enforce: `SAFE_SEGMENT` regex + `.`/`..` rejection + `ALLOWED_UPLOAD_DIRS` whitelist (serve) + `lstat` symlink rejection + `realpath` containment (`startsWith(root + path.sep)`). Streams from the resolved realpath, not the original path.
- **XSS / HTML:** All `dangerouslySetInnerHTML` hits are `<script type="application/ld+json">` blocks fed through `safeJsonLd()` (`</script>`/`<!--` breakout defense) with admin strings pre-sanitized via `sanitizeForOg`. No user-HTML sink.
- **Formula/CSV:** `csv-escape.ts` escapes `= + - @`, strips C0/C1, bidi, and zero-width chars — confirmed clean, unchanged.
- **Header:** OG/route responses set fixed header objects; no untrusted header reflection.

### A04 Insecure Design — CLEAN
- Single-writer topology documented; advisory locks (restore, upload-contract, backfill, per-image, topic, admin-delete) fence the documented races. No new state-coordination surface.

### A05 Security Misconfiguration — CLEAN
- `X-Content-Type-Options: nosniff` global + per-route; `no-store` on dynamic/auth responses; Node runtime pinned on DB/rate-limit routes. Unchanged.

### A06 Vulnerable Components — OUT OF SCOPE
- npm/dependency CVE scanning is a CI concern, not a code finding (per task scope). Not filed.

### A07 Auth Failures — CLEAN
- Login rate limiting (per-IP + per-account buckets with DB backup), session purge, last-admin-deletion guard — unchanged, confirmed clean.

### A08 Integrity Failures — CLEAN
- Backfill paths fenced by advisory lock + `affectedRows` delete-race guards. No untrusted deserialization of code/config.

### A09 Logging Failures — CLEAN
- Audit events logged on LR token use; analytics failures swallowed by design (best-effort). No sensitive data in logs (credentials via env, not logged).

### A10 SSRF — CLEAN
- Per-photo OG route (`api/og/photo/[id]/route.tsx`): the internal Satori photo fetch base is **pinned to the trusted `siteConfig.url` origin** (SEC-01/AGG-M7), falling back to request origin only if unparseable. The path component is a validated UUID-derived filename + numeric size. The Host-header SSRF lever is closed.
- `tryFetchPhotoBuffer` (`og-photo-fetch.ts`): 10s timeout, Content-Length pre-check + post-buffer byte cap (1 MB). No attacker-controlled URL host.

---

## 3. Additional verified surfaces

### Public mutating / expensive routes — rate-limited
- `lint:public-route-rate-limit` PASS. `api/search/semantic` (POST) and `api/search/similar/[id]` (GET, expensive) both: same-origin gate, restore-maintenance guard, integer/codepoint input validation, body-size cap (semantic: 8 KB + Content-Length + chunked-TE rejection), rate-limit pre-increment with Pattern-2 rollback, fail-closed config read, parameterized queries, **public-only field selection** (no PII).
- ID-enumeration oracle defense: OG photo route keeps the rate-limit attempt CHARGED on the 404 branch (SEC-R4C17-01) so it isn't a free enumeration primitive.

### Privacy / PII separation — CLEAN
- `publicSelectFields` derived by destructuring-OMIT from `adminSelectFields` (separate object reference); compile-time `_SensitiveKeysInPublic` guard rejects latitude/longitude/filename_original/user_filename leaking into the public set.
- `publicMapSelectFields` is the only public set exposing GPS, and it is **double-gated**: SQL-layer INNER JOIN on `topics.map_visible = true` + runtime defense-in-depth assertion in `getMapImages()` that refuses to return any row whose topic is not map-visible.
- LR upload + semantic/similar enrichment selects use only public fields (title/description/filename_jpeg/dimensions/topic/camera/lens/date) — no GPS/original-filename.

### Binary parser memory safety (malicious-upload deserialization) — CLEAN
Dedicated deep audit of all 5 attacker-byte parsers (`color-detection.ts` NCLX ISOBMFF walker, `icc-extractor.ts`, `icc-chromaticity.ts`, `gain-map-detection.ts`, `gps-exif-strip.ts`) confirmed for every file:
- Every buffer read bounds-checked before access.
- Box/tag/IFD loops have max-iteration or max-depth caps AND advance offsets by a strictly POSITIVE amount (no zero/negative-size infinite loop).
- Attacker-controlled declared sizes (box size, tag count, string/record length) capped before slice/allocate (e.g. tagCount `Math.min(..,100)`, MAX_IFD_ENTRIES, MAX_SCAN_BYTES, itemCount/extentCount caps).
- All parse errors caught by the caller → malformed file degrades to null/unknown, never crashes the upload worker or request.
No out-of-bounds read, unbounded allocation, or infinite-loop primitive found.

### File-upload path (LR PAT + browser) — CLEAN
- `lr/upload/route.ts`: token-scope auth, `getSafeUserFilename` basename/control-char/length guard, slug validation, `sanitizeAdminString` on title/description with codepoint length caps, restore-maintenance entry+late guards, upload-contract advisory lock, 1 GB disk pre-check, per-token/IP upload-tracker quota (TOCTOU-safe pre-claim + idempotent settle), HDR-ingest gate honoring `allow_hdr_ingest`, GPS strip on disk when `strip_gps_on_upload`, `assertBlurDataUrl` write barrier, orphan-original cleanup on every reject branch. Parity with the browser path.

---

## 4. Explicitly NOT re-reported (already adjudicated)
- ARCH-R7C2-01 / TE-R7C2-02 (Stripe webhook) — CLOSED-OBSOLETE (route deleted run-8).
- RES-R7C6-01 (HEIC GPS-strip residual) — CLOSED.
- session/auth chain — CONFIRMED CLEAN multiple cycles, unchanged.
- admin-string Unicode sanitization — CONFIRMED CLEAN, unchanged.
- privacy derivation — CONFIRMED CLEAN, unchanged.
- OBS-R7C2-03 (restoreDatabase non-transactional) — DEFERRED, operator-mitigated, unchanged.

## Security Checklist
- [x] No hardcoded secrets (scan = 0 hits)
- [x] All inputs validated (type/range/codepoint/slug/content-type/body-size)
- [x] Injection prevention verified (SQL param / path containment / array-spawn / safeJsonLd / CSV escape)
- [x] Authentication/authorization verified (3 lint gates PASS + manual wrapper review)
- [x] SSRF lever closed (OG fetch pinned to trusted origin)
- [x] PII/privacy separation verified (omit-derived + compile guards + map double-gate)
- [x] Public mutating/expensive routes rate-limited (lint PASS + manual)
- [x] Binary parsers memory-safe (dedicated deep audit, 5/5 safe)
- [x] Changed files introduce no regression
- [ ] Dependency audit — out of scope (CI concern, not a code finding)
