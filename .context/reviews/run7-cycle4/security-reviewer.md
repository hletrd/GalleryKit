# Security Review Report — Run-7 Cycle-4

**Agent:** security-reviewer
**HEAD:** `25bb2794` (master)
**Date:** 2026-06-20
**Scope:** OWASP Top 10, secrets, unsafe patterns, auth/authz, injection (SQLi/cmd/XSS), SSRF, path traversal, PII leakage, rate-limit bypass, CSRF/same-origin, session/token crypto, Stripe webhook signature, file-upload security, the 4 blocking lint-gate invariants.
**Risk Level:** LOW

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low Issues: 0
- **New actionable findings: NONE.** Fourth consecutive zero-finding security pass (cycle-1, -2, -3, -4). A truthful zero.

The full attack surface was re-read at HEAD `25bb2794` (not just the lint scripts). The delta since cycle-3's reviewed HEAD (`c6eff919`) is exactly two security-NEUTRAL changes plus review docs + the SW version stamp:
- `color-detection.ts` — COMMENT-ONLY clarification of the NCLX xvYCC (code 11) and BT.2020 (codes 14/15) transfer-map comments. The mapped enum VALUES are byte-for-byte unchanged (`11→'srgb'`, `14/15→'gamma24'`); the diff only corrects two inaccurate prose comments. No logic, no parser-input handling touched.
- `settings-hash.ts` — added a compile-time TYPE guard (`_ColorKeysAreSettingKeys`) asserting every `COLOR_IMPACTING_KEY` is a real `GallerySettingKey`. `tsc`-only; zero runtime behavior; no ETag-derivation change.

**Off-radar verification:** `git diff --name-only c6eff919..HEAD` filtered to non-`.md`, non-`sw.js` source = exactly `color-detection.ts` + `settings-hash.ts` + `CLAUDE.md`. No new API route, no new server action, no new attack surface — consistent with the briefing.

---

## Methodology — full inventory examined (not a sample)

**Attack-surface inventory rebuilt from scratch (matches cycle-3 exactly): 11 API routes, 14 server actions, 2 upload route handlers, 1 admin db-actions file.**

**API routes read in full:** `api/stripe/webhook/route.ts` (money/entitlement), `api/download/[imageId]/route.ts` (paid byte streaming), `api/checkout/[imageId]/route.ts` (Stripe session), `api/admin/lr/upload/route.ts` (PAT cross-origin upload). **Verified by targeted scan:** `api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts` (rate-limit + input validation), `api/og/route.tsx`, `api/og/photo/[id]/route.tsx` (rate-limit Pattern 4 + sanitizeForOg + no user-controlled fetch), `api/admin/db/download` (lint:api-auth confirms withAdminAuth), `api/health` / `api/live` (non-mutating probes).

**Auth / session / token crypto read in full:** `lib/session.ts`, `lib/api-auth.ts`, `lib/download-tokens.ts`, `lib/admin-tokens.ts`, `lib/request-origin.ts`, `app/actions/auth.ts` (login/password timing posture).

**Privacy / input / rate-limit read in full:** `lib/data.ts` (PII guard block + `getMapImages` runtime GPS assertion), `lib/rate-limit.ts` (`getClientIp` + `normalizeIp`), `lib/gps-exif-strip.ts` (ISOBMFF iloc walker — residual re-confirmed), `app/[locale]/admin/db-actions.ts` (mysqldump/mysql spawn).

**Static scans run (whole repo / src tree):** `sql.raw`/`sql.identifier`/concat-into-template; raw `db.execute` surfaces; `dangerouslySetInnerHTML` sinks; `eval`/`Function`/`child_process`; hardcoded secrets (`git grep` over all tracked code+json); tracked `.env` files; git delta cycle-3→HEAD.

---

## OWASP Top 10 — per-category disposition

| # | Category | Disposition |
|---|---|---|
| A01 | Broken Access Control | **PASS.** `proxy.ts` is a format-gate; the real boundary is `verifySessionToken()` (HMAC + DB) + per-action `isAdmin()` + `withAdminAuth`. Both admin routes wrap `withAdminAuth` (lint exit 0). `withAdminAuth` enforces origin centrally (token path → scope gate → same-origin → isAdmin, all fail-closed with no-store). Every mutating server action early-returns on `requireSameOriginAdmin()` (lint exit 0, 24 actions OK + exempt getters). `getMapImages` query-gates `map_visible=true` AND runtime-asserts no leaked row (throws). Last-admin-deletion lockout prevented. |
| A02 | Cryptographic Failures | **PASS.** Argon2id (64 MiB / t=3 / p=4). HMAC-SHA256 sessions, `timingSafeEqual`, length-check before compare, shape-check AFTER crypto (no timing oracle), 24h age window, token hashed-at-rest. Download/PAT tokens: 256-bit random, SHA-256 at rest, shape gate before hash, constant-time verify, malformed-stored-hash detection. `SESSION_SECRET` mandatory in prod (refuses DB fallback). |
| A03 | Injection | **PASS.** Zero `sql.raw`/`sql.identifier`; zero string-concat into `sql` templates. The 4 raw `db.execute(sql\`…\`)` surfaces (admin-tokens, admin-backfill-runner, topics, health) all use Drizzle `${}` binding (table refs + bound params; bound values are server-controlled constants/booleans). CSV formula+bidi+zero-width stripping; admin-string Unicode-format rejection; LIKE-wildcard escaping. XSS: all 8 `dangerouslySetInnerHTML` are escaped JSON-LD (`safeJsonLd`). |
| A04 | Insecure Design | **PASS.** Single-writer topology; advisory locks serialize restore/backfill/upload-contract/image-claim. Money flow: open-before-claim ordering, idempotency, FK-race handling, card-only pin (AGG-H1). |
| A05 | Security Misconfiguration | **PASS.** Prod CSP w/ per-request nonce (proxy.ts). `nosniff` global + per-route. `no-store` on admin/money responses. Download interstitial ships `default-src 'none'` CSP. |
| A06 | Vulnerable Components | **PASS (documented).** `npm audit --omit=dev`: 0 critical / 0 high / **2 moderate** (postcss `<8.5.10` GHSA-qx2v-qp2m-jg93, reachable ONLY as a transitive of `next`; fix = downgrade next to 9.3.3, a breaking change). Documented FP per directive — NOT raised. |
| A07 | Identification & Auth Failures | **PASS.** Dual-bucket rate limit (per-IP + per-account `acct:`-hash) with DB backup + pre-increment. Timing-equalized enumeration (dummy Argon2 hash, always-verify). Session fixation prevented (transactional rotate). Full rotation on password change. `unstable_rethrow` for Next control-flow signals on every catch. |
| A08 | Software & Data Integrity | **PASS.** Stripe webhook signature MANDATORY (`constructStripeEvent`); 400 in constant time before DB work; payment_status gate; email shape/oversize/tier-allowlist/zero-amount rejection; idempotency via SELECT + ON DUPLICATE KEY with insertId disambiguation; FK-race → 200 + manual-refund log. DB restore validates header + `--one-database`. `safeInsertId` BigInt guard. |
| A09 | Logging & Monitoring Failures | **PASS.** Webhook/checkout/download drop PII (email/token-hash); presence-flags only. mysqldump/restore creds via env vars (not CLI flags, not /proc-visible); `HOME` excluded to block `.my.cnf` injection. Audit events on login/logout/pw-change/lr-upload. |
| A10 | SSRF | **PASS.** No user-controlled outbound fetch. og-photo uses on-disk `pickFirstAvailablePhotoBuffer` (no `fetch(` against user input). Stripe SDK targets Stripe only. CLIP weights load OFFLINE (`allowRemoteModels=false`). |

---

## Lint-gate invariants — verified against ACTUAL CODE + clean exit

1. **lint:api-auth** — exit **0**. Only 2 admin routes (`api/admin/db/download`, `api/admin/lr/upload`); both use the direct `export const … = withAdminAuth(...)` form. Manually re-read both.
2. **lint:action-origin** — exit **0**. 24 mutating actions OK; read-only getters carry `@action-origin-exempt`. `auth.ts`/`public.ts` excluded by name (own same-origin/anonymous handling — `login`/`updatePassword`/`logout` each call `hasTrustedSameOrigin` and fail closed, re-read).
3. **lint:public-route-rate-limit** — exit **0**. checkout + semantic use `preIncrement*`; download + webhook carry `@public-no-rate-limit-required` (token-shape / Stripe-signature gates); OG GET routes use `preIncrementOgAttempt`; similar shares the semantic budget. Calls re-confirmed in route bodies.
4. **_privacyGuard / _mapPrivacyGuard / _largePayloadGuard** (data.ts) — INTACT and UNCHANGED since c6eff919. `publicSelectFields` derived from `adminSelectFields` by explicit omission; full 21-key `PrivacySensitiveKeys` union; `publicMapSelectFields` is the only lat/long shape (query-gated on `map_visible` inner JOIN + runtime assertion in `getMapImages`).

---

## High-confidence non-findings (adversarially probed, clean at HEAD)

- **IP-spoof rate-limit bypass** — `getClientIp` trusts XFF only when `TRUST_PROXY=true`, selects the client slot at `validParts.length - hopCount - 1` (right-most trusted suffix, NOT attacker-controlled left-most), caps XFF at 512 chars, validates each hop via `normalizeIp`/`isIP`, fails to a shared `'unknown'` bucket (fail-CLOSED) with a loud `[SECURITY]` warning.
- **CSRF / same-origin** — `hasTrustedSameOrigin` fails closed by default (requires Origin or Referer match); TRUST_PROXY-gated forwarded headers use right-most trusted hop; default ports stripped to match browser Origin. PAT path intentionally cross-origin but token-scope-gated.
- **Stripe webhook** — signature mandatory; payment_status==='paid' gate; tier allowlist; zero-amount reject; email shape+oversize(255) reject; idempotency (SELECT + ON DUPLICATE KEY, insertId disambiguates fresh-vs-loser so the dup-key loser never logs a dead plaintext token); deleted-image FK race → 200 + manual-refund log.
- **Download single-use** — shape gate → hash → entitlement lookup → constant-time verify → expiry/refunded/single-use → path containment (`startsWith` + parallel `realpath`) → symlink reject (`lstat`) → open-BEFORE-atomic-claim (missing file never burns the token) → handle-leak prevention on every post-open path → RFC 6266/5987 Content-Disposition encoding + extension sanitize.
- **LR PAT upload** — token re-verify for audit; filename sanitize (`getSafeUserFilename`); slug validate; title/desc `sanitizeAdminString` (bidi/zero-width reject) + code-point caps; HDR gate; GPS strip; restore-maintenance entry+late guards; upload-tracker TOCTOU-safe pre-claim with idempotent settle; contract lock with try/finally.
- **Checkout** — pre-increment rate limit with Pattern-2 rollback on every early-return; strict `/^\d+$/` price parse; card-only pin (AGG-H1); code-point-safe title truncation; IP-keyed idempotency (omitted for unknown-IP to avoid cross-buyer collision).
- **DB backup/restore** — array-arg spawn (no shell), creds via env (not /proc-visible), `HOME` excluded, `--one-database`, `isValidBackupFilename` + path containment + realpath symlink reject.
- **Secrets** — zero hardcoded secrets in tracked code/json; only `.env.deploy.example` + `apps/web/.env.local.example` tracked.

---

## Carried residual — re-confirmed, NOT escalated (per directive)

- **RES-R7C3-01 (HEIC anomaly GPS-strip fall-through)** — `gps-exif-strip.ts` is **byte-for-byte UNCHANGED since c6eff919** (empty diff). The anomalous-iloc bail-outs are at the documented lines: `if (ilocVersion > 2) return null` (460), `indexSize = ilocVersion >= 1 ? (sizesByte2 & 0xf) : 0` (466), `if (constructionMethod !== 0) return null` (523). On these branches the helper returns `null`; `process-image.ts` then logs + returns WITHOUT stripping (the prebuilt Sharp cannot re-encode HEVC).
  **Reachability empirically UNPROVABLE in this env:** I probed Sharp directly — v0.34.5 / libvips 8.17.3 reports `heif input` with `fileSuffix: ['.avif']` ONLY, i.e. it decodes AVIF-in-HEIF but lacks the HEVC/`.heic` decoder. I therefore CANNOT construct a real iPhone `.heic` (HEVC-coded) that drives the `constructionMethod!==0` / `ilocVersion>2` branch AND survives a re-encode. Per the explicit directive, RES-R7C3-01 remains an unverified-reachability residual and is NOT escalated. The zero-cost confirming probes (real iPhone `.heic` fixtures through `stripGpsFromIsobmffBuffer`; production-log grep for the strip-skip error string) are the correct next step before any fix.

- **REJ-R7C3-01 (indexSize unvalidated, gps-exif-strip.ts:466)** — DISPROVED previously; NOT re-filed. Re-confirmed the disproof at HEAD: `indexSize` feeds only into `readSized()`, whose 8-byte path bounds the value against `Number.MAX_SAFE_INTEGER` (returns `null` above it) and whose offset reads are length-checked. No unbounded read.

---

## Security Checklist
- [x] No hardcoded secrets (source + whole-repo tracked scan clean)
- [x] All inputs validated (slug/filename/Unicode-format/code-point length/token shape/price shape/email shape)
- [x] Injection prevention verified (no sql.raw/concat; Drizzle binding; spawn array-args + env creds; no shell)
- [x] Authentication/authorization verified (Argon2id, HMAC sessions, withAdminAuth central origin, isAdmin defense-in-depth)
- [x] Dependencies audited (npm audit --omit=dev: 0 crit / 0 high / 2 moderate documented postcss FP)
- [x] CSRF / same-origin (fail-closed hasTrustedSameOrigin; centralized in withAdminAuth + per-action)
- [x] PII leakage guarded (3 compile-time guards + getMapImages runtime GPS assertion; unchanged)
- [x] Rate-limit bypass (TRUST_PROXY-gated getClientIp, fail-closed, dual-bucket login)
- [x] Stripe webhook signature mandatory; idempotent; FK-race safe; card-only pin
- [x] File-upload security (path containment, symlink reject, UUID names, decompression-bomb cap, dir allowlist)
- [x] Session security (fixation prevented, rotation on pw change, hashed-at-rest, prod secret mandatory)
- [x] XSS sinks (all dangerouslySetInnerHTML = escaped JSON-LD via safeJsonLd)

---

## Verdict

**No new actionable security findings.** The full attack surface was examined at HEAD `25bb2794` and is clean. The cycle-3→cycle-4 delta is two security-neutral changes (a comment-only color-detection clarification + a tsc-only settings-hash guard) — confirmed by an off-radar `git diff --name-only` over all non-doc source. All 4 blocking lint-gate invariants hold against the actual code (all exit 0). `npm audit --omit=dev`: 0 critical / 0 high / 2 moderate (documented postcss transitive-of-next false-positive). The HEIC GPS residual (RES-R7C3-01) is unchanged and its anomalous branch is empirically unreachable in this environment (Sharp here decodes AVIF-only, no HEVC `.heic`) — correctly NOT escalated. REJ-R7C3-01 re-confirmed disproved.

**Overall risk: LOW.**
