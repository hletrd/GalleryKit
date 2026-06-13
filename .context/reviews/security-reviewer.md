# Security Review — Fresh Adversarial OWASP Top 10 Pass

**Date:** 2026-06-13
**HEAD:** `1dde9b1e` (working tree CLEAN)
**Angle:** OWASP Top 10 (A01–A10), secrets, unsafe patterns (eval / dangerouslySetInnerHTML / raw SQL concat / path traversal / ReDoS / prototype pollution / open redirect / insecure deserialization), auth/authz, CSRF, SSRF, XSS, timing oracles.

> Note: this file was persisted by the orchestrator from the security-reviewer agent's delivered report — the agent ran read-only (Write/Edit blocked in its context) and returned the review in its final message. Content is verbatim from that agent.

## Summary
- **Critical: 0 | High: 0 | Medium: 0 | New Low: 0**
- **Risk Level: LOW.** No live-exploitable vulnerability across the full OWASP Top 10 at HEAD `1dde9b1e`. Validated from code with current line numbers, not from comments. The prior `ce0029aa` clean verdict still holds — honest convergence.

## Delta `ce0029aa..1dde9b1e` — four source files, all security-neutral
| File | Change | Impact |
|---|---|---|
| `apps/web/scripts/backfill-color-pipeline.ts` | adds `affectedRows===0` orphan-cleanup (`cleanupDeletedMidReencode` -> `deleteImageVariants(UPLOAD_DIR_*, row.filename_*, [])`) | None. UUID-derived DB filenames, fixed dirs, `${value}`-bound SQL. Disk-hygiene only. |
| `apps/web/src/lib/image-queue.ts` | delete-race cleanup passes `[]` (dir-scan) | None. Disk-hygiene. |
| `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` | +11 lines COMMENT documenting the EXIF-vs-validated-field `sanitizeForOg` asymmetry | None. |
| `apps/web/src/app/[locale]/(public)/page.tsx` | COMMENT correction (og:image fallback) | None. |

Public-API route inventory unchanged (8 non-admin routes). No new attack surface.

## RE-VERIFIED CLEAN (current line numbers)
- **A01** `proxy.ts:54-116` guard; `api-auth.ts:93,100` central CSRF+`isAdmin`; `allowTokenScope` set on exactly ONE route (`lr/upload:484`, scope `lr:upload`); actions lint-gated `isAdmin()`+`requireSameOriginAdmin()`; PAT-revoke user-scoped (`admin-tokens.ts:230`); base-56 share keys (no IDOR).
- **A02/A07** Argon2id 65536/3/4 shared (`password-hashing.ts:10`); HMAC-SHA256 `timingSafeEqual`+length-precheck, shape-regex AFTER verify (`session.ts:113-125`); prod-only env secret throws if absent (`session.ts:30`); login pre-increment-before-Argon2 (`auth.ts:124`), dummy-hash (`:177`), session-fixation txn (`:210-222`), no-rollback-on-infra-error (`:248`); `getClientIp` trusts XFF only when `TRUST_PROXY=true`, hop-before-suffix selection (`rate-limit.ts:176`).
- **A03** zero `sql.raw` (grep); smart-collections allowlist via `hasOwnProperty.call` + scalar-enforce + LIKE-escape `/[%_\\]/g` + bound values (`smart-collections.ts:46,202-236`), AST is admin-authored; `spawn` argv mysqldump/mysql with env creds, no shell, `--one-database`, no HOME (`db-actions.ts:157,454`); `serve-upload.ts:144-251` SAFE_SEGMENT+symlink-reject+realpath-TOCTOU+no-SVG; download dual-realpath containment.
- **XSS** all **8** `dangerouslySetInnerHTML` -> `safeJsonLd` (escapes the angle-bracket + U+2028/U+2029); OG text -> unified `sanitizeForOg` (global-flag `stripUnicodeFormatting`+C0); EXIF asymmetry correct.
- **A04** download single-use CAS: open-before-claim (`download/[imageId]:349`), atomic `UPDATE ... WHERE downloadedAt IS NULL`, handle closed on every failure path; GET interstitial claim-free.
- **A08** Stripe signature mandatory-first (`webhook:74`), idempotency SELECT+`insertId>0` disambiguation (`:357-382`), FK-deleted-image 200; JSON shape-validated everywhere (`clampSemanticTopK` rejects non-number).
- **A10** OG fetch own-origin (`og-photo-fetch.ts:50`), DB-UUID filename, 10s timeout, 1 MB cap, no user URL.
- **Misc** no open redirect (`deriveLocaleFromReferer` returns allowlist-validated enum); regexes linear (no ReDoS); proto-pollution-safe; CSV formula-escape closes ZWSP-before-`=` bypass; secrets sweep clean; `npm audit` unchanged (build/dev-only, downgrades rejected).

## NET-NEW VULNS THIS CYCLE: 0
