# Security Review Report — GalleryKit

**Reviewer:** security-reviewer (run-6, cycle-4)
**HEAD:** f8147868
**Date:** 2026-06-16
**Scope:** OWASP Top 10 — auth/authz, secrets, injection (SQL/command/path), SSRF, XSS, CSRF/same-origin, file-upload safety, rate-limiting, session handling, privacy (PII/GPS leakage), unsafe deserialization. Full inventory examined (not sampled), plus a focused regression audit of the cycle-3→cycle-4 diff (b1e9e0da..f8147868) and direct verification that the three security lint gates enforce what they claim.
**Risk Level:** LOW

## Summary

- Critical Issues: 0 (new)
- High Issues: 0 (new)
- Medium Issues: 0 (new)
- Low / Informational: 0 (new)

**Honest convergence. Zero new findings.** This is cycle 4 of a system where ~58 prior findings have been closed and independently re-verified. I re-derived every primary attack surface from current HEAD source (three parallel deep audits: auth/session/crypto, injection/path/SSRF, privacy/data-layer/upload), audited the small cycle-3→4 source diff for any regression introduced by prior-cycle fixes, read both security lint-gate scanners line-by-line to confirm their enforcement is real, and re-confirmed the three previously-deferred security items are still correctly deferred at HEAD. I found NO new injection, auth-bypass, SSRF, XSS, CSRF, secret-exposure, or privacy-leak vulnerability. The three deferred items (AGG-C3-31 git-history secret, AGG-C3-32 SQL-restore comment bypass, AGG-C3-33 admin-token last_used_at ordering) remain factually correctly deferred — their deferral reasoning is NOT wrong at HEAD, so per the loop rules they are not re-reported as new findings here.

---

## Regression audit of the cycle-3→cycle-4 window (b1e9e0da..f8147868)

10 commits landed. The non-doc, non-test source changes are limited and ALL security-neutral or security-positive — none touch an auth/session/injection/privacy decision:

| File | Change | Security assessment |
|---|---|---|
| `src/app/actions/images.ts:29` | `isWideGamutPrimary` import repointed from `color-detection` → `color-primaries` (client-safe leaf) | Neutral. Same predicate, drops a server-only re-export; no behavioral change. The `requireSameOriginAdmin()` + HDR-gate + UUID-filename + blur-validation logic in `uploadImages` is untouched. |
| `src/lib/color-detection.ts:43-50` | Removed the `WIDE_GAMUT_PRIMARIES`/`isWideGamutPrimary` re-export (AGG-C3-18 layering fix) | Neutral/positive. Removes a path that could pull `fs`/Sharp into a client bundle. No runtime auth/data effect. |
| `src/lib/process-topic-image.ts:12-20` | Added `TOPIC_RESOURCES_ROOT` env override (test isolation, ORCH-C3-TMPDIR) | Neutral. Production leaves it unset → cwd-derived behavior unchanged. The downstream `isValidFilename` validation (`process-topic-image.ts` import) still applies; the env var only redirects the scratch/output ROOT, not user input. Not a traversal vector (operator-controlled env, not request data). |
| `scripts/backfill-color-pipeline.ts:334-484` | Track `detectionFailures` and exit non-zero on them (AGG-C3-04) | Neutral. Exit-code/observability only. No DB-write or auth change; data-integrity resume contract preserved. |
| `src/lib/serve-upload.ts:197-205` | Comment de-enumeration (AGG-C3-06) | Comment-only. The ETag still folds `COLOR_IMPACTING_KEYS` via `settings-hash.ts`. |
| `src/lib/settings-hash.ts:17-24` | Docstring max-age fix (AGG-C3-05) | Comment-only. |
| `src/components/switch.tsx`, `histogram.tsx` | UI geometry / a11y contrast | No security surface. |

**Verdict: no security regression introduced by the cycle-3 fixes.**

---

## Lint-gate enforcement verification (task item #3 — "verify the gates actually enforce what they claim")

I read both scanner implementations in full and ran all three gates. They are not merely passing — they are hardened against the specific bypasses prior cycles discovered:

**`scripts/check-action-origin.ts`** (same-origin on every mutating server action):
- Recursive discovery over `app/actions/**` (line 57-76) — closes the single-level-readdir gap (C6R-RPL-02); a mutating action in a nested subdir is auto-covered.
- Aliased re-exports are a HARD FAILURE (line 315-323) — closes "a refactor silently drops the guard" (AGG5R-01).
- `@action-origin-exempt` on a body that contains a direct mutating call is a HARD FAILURE, not a skip (line 289-294, SEC-R4C2-02) — an exempt comment cannot smuggle a mutating action past the gate.
- The guard must be stored to a variable AND early-returned at top level (line 223-252); a bare/ignored `requireSameOriginAdmin()` call, a dead branch, or an uncalled nested helper does NOT satisfy it. Pre-guard mutations also fail (line 238-240).
- Runtime output at HEAD: 17 mutating actions OK + 1 read-only exempt (`tags.ts::getAdminTags`). "All mutating server actions enforce same-origin provenance."

**`scripts/check-api-auth.ts`** (`withAdminAuth(...)` on every `/api/admin/**` handler):
- Recursive route discovery across ALL 5 Next.js route extensions `.ts/.tsx/.js/.mjs/.cjs` (line 24-43) — closes C5R-RPL-02 (a `route.tsx` admin handler cannot evade).
- Aliased exports (line 103-110), function-declaration exports, and class-declaration exports (line 131-135) of an HTTP method are all rejected — forces the explicit `METHOD = withAdminAuth(...)` variable-export form.
- A route file exporting NO HTTP handler is a failure (line 138-140) — no silently-empty admin route.
- Runtime output at HEAD: both admin routes (`db/download`, `lr/upload`) OK.

**`scripts/check-public-route-rate-limit.ts`**: 9 public routes OK at HEAD. Documented blind spot = GET handlers are not scanned. The two expensive public GETs that fall in that blind spot are independently rate-limited:
- `api/og/route.tsx:54` — `preIncrementOgAttempt(ip, ...)` → 429.
- `api/og/photo/[id]/route.tsx:46` — `preIncrementOgAttempt(ip, ...)` → 429 (origin pinned to `siteConfig.url`, SSRF fix holds).
- `api/search/similar/[id]/route.ts:83` — `preIncrementSemanticAttempt(ip, ...)` → 429.
- `api/download/[imageId]` carries `@public-no-rate-limit-required` (gated by single-use token claim).

**The one action file excluded from the action-origin gate by name (`public.ts`) is genuinely the anonymous read+analytics surface.** Its only mutations are `db.insert(imageViews/topicViews/sharedGroupViews)` at lines 360/381/397 — the documented best-effort anonymous view-count recorders (`recordPhotoView`/`recordTopicView`/`recordSharedGroupView`), each rate-limited; search/load-more carry their own per-IP rate limiting (lines 30-52). No mutating ADMIN action is hiding in `public.ts`. `auth.ts` (the other excluded file) owns its `hasTrustedSameOrigin` calls directly.

---

## Deferred-item re-confirmation (still correctly deferred at HEAD — NOT new findings)

The task says to re-report a deferred item only if its deferral reasoning is factually wrong at HEAD. All three remain factually correct:

- **AGG-C3-31 — git-history SESSION_SECRET/passwords (operational, HEAD-clean).** HEAD `apps/web/.env.local.example` uses placeholders only (`DB_PASSWORD=<change-me>`, `SESSION_SECRET=<generate-with: openssl rand -hex 32>`, `ADMIN_PASSWORD=<generate-a-strong-admin-secret-or-argon2-hash>`). A live-secret literal scan (`sk_live_`/`sk_test_`/`whsec_`/`AKIA`/PEM/64-hex) over `src` + `scripts` returns ZERO. Production still refuses the DB-stored secret fallback (`session.ts:30`, throws in `NODE_ENV=production`). The exposure is purely in git history; no code change at HEAD remediates it. Deferral as operational is correct.
- **AGG-C3-32 — SQL-restore inter-token comment bypass.** `sql-restore-scan.ts:104` still DELETES block comments (`.replace(/\/\*.*?\*\//gs, '')`, not space-replace), so `DROP/**/TABLE`→`DROPTABLE` still slips the `\bDROP\s+TABLE\b` pattern. But the restore path remains triple-gated: `isAdmin()` (`db-actions.ts:47/125/272`) + `requireSameOriginAdmin()` (`:51/129/276`) + `mysql --one-database`, AND app-table drops are intentionally allowed during a legitimate restore. The scanner is defense-in-depth, not a primary control. Deferral correct. (Optional one-line hardening still available: replace stripped comments with a space.)
- **AGG-C3-33 — `admin-tokens.verifyToken` bumps `last_used_at` before scope check.** Confirmed: `verifyToken` (`admin-tokens.ts:154-159`) checks hash (constant-time `tokenHashesEqual`) + expiry, then fire-and-forget bumps `last_used_at`; the SCOPE check is in the caller `api-auth.ts:67` (`tokenHasScope`), which runs after `verifyToken` returns. So `last_used_at` updates for a valid-but-wrong-scope token on a 401 path. Cosmetic — the request is still rejected; the timestamp is advisory. Deferral correct.

---

## Confirmed-hardened at HEAD f8147868 (verified this cycle — NOT findings)

**Authentication & sessions** (`session.ts`, `password-hashing.ts`, `auth.ts`): Argon2id memoryCost 65536 / timeCost 3 / parallelism 4, single shared `PASSWORD_HASH_OPTIONS` across login/change/seed/dummy. HMAC-SHA256 session tokens verified with `timingSafeEqual` (`session.ts:117`); token-shape regex checks run AFTER the crypto compare (`:121-125`, no timing oracle); 24h age bound (`:131`); session token SHA-256 hashed before DB storage (`:10/:136`); production throws on missing `SESSION_SECRET` (`:30`). Login: per-IP + per-account (`acct:<sha256>`) buckets, pre-incremented BEFORE Argon2 (TOCTOU-safe), dummy-hash timing equalization, transactional session-fixation prevention (insert-new-then-delete-others), no rate-limit rollback on infra error.

**Same-origin / CSRF** (`request-origin.ts`, `action-guards.ts`, `api-auth.ts`): `hasTrustedSameOrigin` FAILS CLOSED (returns false without an explicit Origin/Referer match); X-Forwarded-* gated on `TRUST_PROXY` with right-most-hop selection. `withAdminAuth` enforces origin + `isAdmin()` centrally, auto-applies no-store + nosniff; the PAT path bypasses origin BY DESIGN, gated on token validity + scope. `requireSameOriginAdmin()` on every mutating action (lint-enforced, verified above).

**Injection** (SQL/command/path/formula): All app queries use Drizzle ORM or parameterized `sql\`\`` / `?` placeholders — independent fan-out found ZERO string-concatenation into SQL. `mysqldump`/`mysql` spawned with array args (no `shell:true`), credentials via `MYSQL_PWD` env, HOME excluded, `--one-database` on restore. Path traversal: `serve-upload.ts` + `db/download` + `download/[imageId]` use `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `lstat` symlink rejection + realpath containment, streaming from the RESOLVED path (TOCTOU-safe). `storage/local.ts normalizeStorageKey` rejects `..`/leading-slash/empty segments. CSV: C0/C1 + bidi + zero-width strip, `=+-@` prefixing, quote-doubling. No `eval`/`Function`/`vm`/dynamic-`require` on user input.

**XSS / output encoding:** All 8 `dangerouslySetInnerHTML` sinks feed JSON-LD via `safeJsonLd` (escapes `</script>`, U+2028/2029) — verified each site (home `page.tsx:208/217`, `p/[id]/page.tsx:275/282` also carry CSP nonce, plus topic/timeline/year/c-slug). OG (Satori) text run through `sanitizeForOg` on both routes. Admin string surfaces reject `UNICODE_FORMAT_CHARS` at validation. Global headers: nosniff, X-Frame-Options, Referrer-Policy, HSTS, locked Permissions-Policy, nonce CSP in prod.

**SSRF:** OG per-photo internal fetch pinned to `siteConfig.url` (`og/photo/[id]/route.tsx:112-116`), not request Host; 10s timeout + 1 MB cap (`og-photo-fetch.ts`). Filename source is `crypto.randomUUID()`-derived DB value, not attacker-controlled.

**Stripe / paid downloads:** Webhook signature mandatory — `constructStripeEvent` throws without `STRIPE_WEBHOOK_SECRET` (`stripe.ts:38`), missing `stripe-signature` → 400 (`webhook/route.ts:60`), Stripe's constant-time `constructEvent` (`stripe.ts:51`); `payment_status === 'paid'` gate (`:105`); `payment_method_types: ['card']` (async-payment gap closed operationally). Download tokens: `dl_<43 base64url>`, SHA-256 hashed, single-use atomic claim, `timingSafeEqual`.

**File-upload safety:** UUID filenames (no user-controlled names on disk), Sharp `limitInputPixels` (256 MP default, decompression bomb), per-file 200 MB + cumulative byte + file-count window caps, HDR-ingest gate honored on BOTH the browser path (`images.ts:282`) AND the Lightroom PAT path (`lr/upload/route.ts:300`), `assertBlurDataUrl` at write time on both paths.

**Privacy:** `publicSelectFields` derived from `adminSelectFields` by OMISSION (separate object ref) with compile-time `_SensitiveKeysInPublic`/`_PrivacySensitiveKeys` (`data.ts:407-419`) + `_mapPrivacyGuard` (`:431`). GPS (`latitude`/`longitude`) exposed ONLY via `publicMapSelectFields`, gated on `topics.map_visible = true` INNER JOIN + runtime assertion. `getImagesForFeed` selects `...publicSelectFields` + JOIN-derived `author_name: adminUsers.username` — the raw `uploaded_by` id stays admin-only. GPS scrubbed from the on-disk ORIGINAL (the file the paid-download route streams) via bounds-checked byte-level `gps-exif-strip.ts` (every walker returns null on anomaly → metadata-free re-encode; never `withMetadata()`). No new image schema column leaks to a public surface.

**ReDoS / deserialization:** SQL-scanner / CSV / validation regexes use bounded/non-nested quantifiers. Semantic route caps body 8 KB + rejects chunked + validates Content-Type prefix + JSON shape.

**CLIP semantic search:** remains dark-by-design. HARD GUARD honored — not proposing activation; reviewed its route only for input-handling safety (8 KB body cap, content-type + chunked checks, rate-limited).

---

## Security Checklist

- [x] No hardcoded/live secrets at HEAD (placeholders only; live-secret literal scan over src+scripts returns zero)
- [~] Secrets in git history — historical SESSION_SECRET/passwords recoverable (AGG-C3-31, deferred/operational, HEAD-clean, documented in CLAUDE.md)
- [x] All inputs validated (codepoint-aware length, Unicode-format rejection, slug/filename regex, JSON shape + size caps)
- [x] Injection prevention verified (parameterized SQL, array-arg spawn, path containment + symlink rejection, CSV formula escaping)
- [x] Authentication/authorization verified (Argon2id, HMAC + timingSafeEqual, middleware guard, withAdminAuth + requireSameOriginAdmin, BOTH lint gates read line-by-line and confirmed enforcing, last-admin guard, advisory locks)
- [x] SSRF prevented (OG fetch pinned to trusted origin, timeout + size cap)
- [x] XSS prevented (all 8 JSON-LD sinks via safeJsonLd + nonce, OG sanitized, security headers + CSP)
- [x] CSRF prevented (fail-closed same-origin on every mutating action + admin API route; gates verified robust)
- [x] Privacy enforced (compile-time public/admin/map field guards, GPS byte-strip on originals, uploaded_by id admin-only)
- [x] Dependencies — Stripe SDK signature path justified; dependency CVE audit (`npm audit`) not run in this read-only pass — recommend running in CI
- [x] CLIP semantic search remains dark-by-default; HARD GUARD respected — NOT proposing activation
- [x] No security regression in the cycle-3→cycle-4 diff (b1e9e0da..f8147868)
