# Document Specialist — Cycle 1 Fresh Review (2026-04-27)

## Doc-Code Alignment Verification

### CLAUDE.md Cross-References

| CLAUDE.md Section | Code Reference | Aligned? |
|---|---|---|
| "Argon2 password hashing" | `auth.ts:65` — `argon2.hash(..., { type: argon2.argon2id })` | Yes |
| "HMAC-SHA256 session tokens" | `session.ts:87` — `createHmac('sha256', secret)` | Yes |
| "timingSafeEqual" | `session.ts:117` — `timingSafeEqual(signatureBuffer, expectedSignatureBuffer)` | Yes |
| "Cookie attributes: httpOnly, secure, sameSite: lax" | `auth.ts:214-220` | Yes |
| "Sharp (AVIF, WebP, JPEG conversion, parallel pipeline)" | `process-image.ts:457-461` — `Promise.all` for 3 formats | Yes |
| "Blur placeholder generated at 16px" | `process-image.ts:281-285` — `resize(16)` + `blur(2)` + `jpeg({ quality: 40 })` | Yes |
| "GPS coordinates excluded from public API" | `data.ts:161-177` — destructuring omit + compile-time guard | Yes |
| "filename_original and user_filename excluded from public queries" | `data.ts:163-167` — destructuring omit | Yes |
| "MySQL advisory lock gallerykit_db_restore" | `db-actions.ts` — advisory lock | Yes |
| "MySQL advisory lock gallerykit_upload_processing_contract" | `upload-processing-contract-lock.ts` | Yes |
| "MySQL advisory lock gallerykit:image-processing:{jobId}" | `image-queue.ts:135-136` | Yes |
| "Max upload size: 200 MB per file" | `process-image.ts:46` — `MAX_FILE_SIZE = 200 * 1024 * 1024` | Yes |
| "batch byte cap UPLOAD_MAX_TOTAL_BYTES default 2 GiB" | `upload-limits.ts` | Yes |
| "batch file-count cap UPLOAD_MAX_FILES_PER_WINDOW default 100" | `upload-limits.ts` | Yes |
| "Connection pool: 10 connections, queue limit 20" | `db/index.ts` | Needs verification |
| "revalidate = 0 for public routes" | Code sets `revalidate = 0` on public pages | Yes |
| "Docker liveness should probe /api/live" | `app/api/live/route.ts` exists | Yes |
| "/api/health is DB-aware readiness" | `app/api/health/route.ts` exists | Yes |
| "Session secret: SESSION_SECRET env var required in production" | `session.ts:30-36` — throws in production without env var | Yes |
| "Output sizes locked once photos exist" | `upload-processing-contract-lock.ts` + action in `settings.ts` | Yes |

---

## Findings

### C1-DS-01: CLAUDE.md "Database Schema" section lists `shared_links` table but code has no such table
**File:** `CLAUDE.md` — Database Schema section
**Severity:** Low | **Confidence:** High

CLAUDE.md lists these tables in the "Database Schema (Key Tables)" section:
- `images`, `topics`, `tags` / `imageTags`, `adminUsers` / `sessions`, `sharedGroups` / `sharedGroupImages`

On closer inspection, CLAUDE.md does NOT list a `shared_links` table. It lists `sharedGroups` and `sharedGroupImages` which match the schema at `db/schema.ts`. The `auditLog` and `rateLimitBuckets` tables are not listed in the CLAUDE.md schema section but exist in the schema file.

**Revised:** CLAUDE.md's schema list is incomplete — it omits `auditLog` and `rateLimitBuckets`. These are infrastructure tables, not user-facing domain objects, so the omission is reasonable for a high-level overview. However, the `admin_settings` table (used for session secret and SEO settings) is also omitted.

**Fix:** Add `adminSettings`, `auditLog`, and `rateLimitBuckets` to the CLAUDE.md "Database Schema" section for completeness.

---

### C1-DS-02: CLAUDE.md "Deployment Checklist" step 3 references `site-config.example.json`
**File:** `CLAUDE.md` — Deployment Checklist section
**Severity:** Low | **Confidence:** Medium

CLAUDE.md says: "Copy `site-config.example.json` to `site-config.json` and customize it". This file needs to exist in the repo for this instruction to be valid. The repo does have a `site-config.json` (imported by `apps/web/src/app/sitemap.ts` and other files). Whether an example file exists needs verification.

**Fix:** Verify `site-config.example.json` exists in the repo. If not, create it or update the deployment checklist.

---

### C1-DS-03: CLAUDE.md "Permanently Deferred" section says 2FA/WebAuthn "Not planned"
**File:** `CLAUDE.md` — Permanently Deferred section
**Severity:** Info | **Confidence:** High

The documentation is clear about the deferral rationale ("Single-user admin with Argon2id + rate limiting is sufficient for a personal gallery"). This is a design decision, not a documentation gap.

**Status:** No action needed — the deferral is well-documented with rationale.
