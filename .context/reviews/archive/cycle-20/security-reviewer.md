# Security Review — GalleryKit (Cycle 20)

**Date:** 2026-06-27 · **HEAD:** 9af705f4 · **Reviewer:** security-reviewer
**Risk Level: LOW.** Critical 0 · High 0 · Medium 0 · Low 0 (new) · Info 1.

`npm audit --omit=dev` → **0 vulnerabilities**. `tsc` (typecheck:app + typecheck:scripts) exit 0 — every privacy / search-enrichment / smart-collection compile-guard HOLDS at HEAD. lint:api-auth, lint:action-origin, lint:public-route-rate-limit all exit 0. No hardcoded secrets; `.env*` gitignored.

## Summary
- Critical: 0 · High: 0 · Medium: 0 · Low (new this cycle): 0
- One INFO (verified-benign residual). Two prior-cycle LOW defense-in-depth items (SEC-19-01, SEC-19-02) carried over UNCHANGED — not materially worse, not re-raised per loop rules.

**Verdict:** This is the 20th security-focused cycle on an exceptionally hardened codebase. The cycle-19 security-relevant fixes (GPS-strip ISOBMFF re-encode fallback, view-retention `Number()` parse, OG fetch 10s budget, search-enrichment compile-guarded module, BoundedMap.entries() shallow-copy) are all CORRECT and open no new holes. No confirmed-exploitable NEW vulnerability was found across the full OWASP Top 10 sweep.

---

## Informational (verified-benign)

### SEC-20-INFO — ISOBMFF GPS-strip `walkAborted` re-encode fallback is gated only on the zero-items branch
Category A01/Privacy (defense-in-depth). `apps/web/src/lib/gps-exif-strip.ts:461-465`. The cycle-19 F2 fix sets `walkAborted=true` on a malformed/oversized box and forces a metadata-free re-encode ONLY when `exifItemIds.size === 0 && xmpItemIds.size === 0`. If the bounded walk finds ≥1 Exif/XMP item and THEN aborts on a later malformed sibling box inside `meta`, the function strips the found item's GPS and returns `{stripped:true}` rather than re-encoding. **Verified non-exploitable:** (a) the found item's GPS IS neutralized; (b) a real-world HEIF/AVIF carries a single Exif item; (c) any item past the corruption has no `infe`/`iloc` entry to be located by, so it cannot be a parseable GPS-bearing region; (d) if `iloc` falls after the malformed box, `ilocBox` is null → `return null` → re-encode already fires. No action required; recorded for completeness only.

## Carried-over (prior-cycle LOW defense-in-depth — status unchanged, NOT re-raised)
- **SEC-19-01** — per-IP rate-limit buckets key full IP; IPv6 /64 rotation evades. `lib/rate-limit.ts:112-130`. Account-scoped login bucket + per-request hard caps (SEMANTIC_SCAN_LIMIT/TOP_K) remain the in-place controls. Not worse this cycle.
- **SEC-19-02** — token-auth `verifyToken` DB lookup not IP-throttled pre-DB. `lib/api-auth.ts` token branch → `lib/admin-tokens.ts:136-159`. 256-bit token, `isWellFormedToken` rejects malformed at zero DB cost, O(1) indexed lookup. Marginal. Not worse this cycle.

---

## Confirmed-clean (verified this cycle)

**Privacy split (A01/Privacy) — HOLDS.** `lib/data.ts` `adminSelectFields` → `publicSelectFields` (omits lat/long/filename_original/user_filename/processed/color_space/icc_profile_name/pipeline_version/HDR internals) and `publicMapSelectFields` (adds ONLY lat/long, used solely by `getMapImages()` which INNER-JOINs `topics.map_visible=true` + runtime per-row assertion). `_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard`, `searchFields` `_searchPrivacyGuard`, and the new `lib/search-enrichment-fields.ts` `_searchEnrichmentPrivacyGuard` all compile clean (tsc exit 0). The new module uses a TYPE-ONLY import of `PrivacySensitiveKeys` (erased at runtime — no data.ts runtime pull into route bundles). Its column set {id,title,description,filename_jpeg,width,height,topic,topic_label,camera_model,lens_model,capture_date} contains NO PII key.

**Search routes (A01/A03/A04) — clean.** `api/search/semantic/route.ts` + `api/search/similar/[id]/route.ts`: `hasTrustedSameOrigin` 403 gate → restore-maintenance 503 → body-size/Content-Type/transfer-encoding guards → `preIncrementSemanticAttempt` rate-limit (Pattern 2 rollback) → mode gate (503 unless stub/production) → bounded scan (`SEMANTIC_SCAN_LIMIT`=2000) → enrichment via shared compile-guarded `searchEnrichmentSelectFields` filtered `processed=true`. Enrichment failure now logged then empty (MINOR-1 fix). All returned images are public processed rows — no per-image ACL bypass possible (gallery has no private-image concept).

**OG routes SSRF (A10) — fail-closed.** `api/og/photo/[id]/route.tsx`: server-side photo fetch origin pinned to `new URL(siteConfig.url).origin`, fails CLOSED (returns fallback) when siteConfig.url unset/unparseable — never falls back to attacker-controllable `req.url` origin. `pickFirstAvailablePhotoBuffer` 10s-per-attempt + 10s total budget (CQ19-01), 1 MB byte cap, charged 404/miss (no enumeration refund). `buildFallbackResponse` validates admin `og_image_url` same-origin before 302. `api/og/route.tsx` renders text only (no photo fetch), rate-limited, ETag 304, all admin strings `sanitizeForOg`-stripped. IMAGE_BASE_URL is operator-env (validated absolute https, no creds, at startup) — NOT used in any server-side fetch.

**LR upload token path (A01/A07) — clean.** `api/admin/lr/upload/route.ts` wrapped in `withAdminAuth(..., {allowTokenScope:'lr:upload'})`. Token model (`lib/admin-tokens.ts`): 256-bit random, stored SHA-256 only, `timingSafeEqual` hex compare, scope + `expires_at` enforced, fail-closed on missing table, plaintext never in query params. Full upload validation parity with browser path (filename basename+control-char reject, topic slug, code-point title/desc limits, GPS strip on-disk, HDR-ingest gate, disk-space `bavail`, quota tracker TOCTOU pre-claim with idempotent settle, restore-maintenance entry+late re-check, contract advisory lock).

**Auth wrapper / CSRF (A01) — centralized.** `withAdminAuth` enforces origin (`hasTrustedSameOrigin`) for cookie path before `isAdmin()`; token path bypasses origin by design (PAT integration) but requires valid scoped token. `requireSameOriginAdmin()` returns-early in every mutating server action (lint:action-origin green; `auth.ts`/`public.ts` intentionally excluded by name). All `api/admin/**` handlers use `export const = withAdminAuth(...)` (no function-decl / aliased-export scanner evasion). Public route handlers (health/live/og/og-photo/search) carry their own same-origin + rate-limit gates.

**Injection (A03) — parameterized.** Drizzle param binding throughout. `lib/smart-collections.ts` compiler: column allowlist (throws on unknown), MAX_DEPTH 4, MAX_IN_VALUES 100, `isScalarValue` runtime enforcement (rejects object/array/null/NaN before mysql2 escaping), LIKE `%_\` escaping on `contains`, all values param-bound including `BETWEEN`. `is_public` enforced on BOTH `c/[slug]/page.tsx` and `loadMoreSmartCollectionImages`. `searchImages` LIKE-escaped + code-point capped. `db/download` filename allowlist + `lstat` symlink reject + dual `realpath` containment (TOCTOU-closed).

**Rate-limit / proxy (A04) — fail-safe.** `getClientIp` trusts XFF only when `TRUST_PROXY=true`, right-anchored by `TRUSTED_PROXY_HOPS`, falls to `'unknown'` otherwise with one-time [SECURITY] warn. `BoundedMap` hard-cap FIFO eviction + expiry prune; `entries()` now yields shallow copies (CQ19-02) matching `get()`. `request-origin.ts` fails closed (requires Origin/Referer match). view-retention `Number()` parse (F1) + non-positive→default guard.

**Misc — clean.** `next.config.ts` remotePatterns restricted to imageBaseUrl + `/uploads`/`/resources`; global `X-Content-Type-Options: nosniff`. admin-user delete: self-delete prevention + table-wide advisory-lock-serialized last-admin guard. CSP nonce-based script-src (no unsafe-inline/eval); style-src 'unsafe-inline' is the standard Next/Tailwind requirement (info, not a vuln).

## Findings
- SEC-20-INFO | INFO | gps-exif-strip.ts:461-465 — ISOBMFF walkAborted re-encode only on zero-items branch (verified non-exploitable)
- SEC-19-01 | LOW (carried) | rate-limit.ts:112-130 — IPv6 /64 rate-limit evasion (status unchanged)
- SEC-19-02 | LOW (carried) | api-auth.ts/admin-tokens.ts — token verify DB lookup un-throttled pre-DB (status unchanged)

## Security Checklist
- [x] No hardcoded secrets (.env* gitignored, no key/token literals in src)
- [x] All inputs validated (code-point limits, slug/filename allowlists, Unicode-format reject, scalar enforcement)
- [x] Injection prevention verified (Drizzle params, smart-collection allowlist compiler, LIKE escaping)
- [x] Authn/authz verified (withAdminAuth wrap, requireSameOriginAdmin early-return, token scope/expiry, last-admin guard)
- [x] Privacy/PII guards verified (publicSelectFields/searchFields/searchEnrichment compile-guards hold; GPS map-gated)
- [x] SSRF verified (OG fetch host-pinned fail-closed; IMAGE_BASE_URL operator-env only)
- [x] Dependencies audited (`npm audit --omit=dev` → 0 vulnerabilities)
