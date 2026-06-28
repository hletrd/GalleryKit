# Security Review — GalleryKit (Cycle 19)

**Risk Level: LOW.** Critical 0 · High 0 · Medium 0 · Low 2 · Info 1.
`npm audit --omit=dev` → 0 vulnerabilities. lint:api-auth / lint:action-origin / lint:public-route-rate-limit all pass. No hardcoded secrets; `.env*` gitignored.

## LOW

### SEC-19-01 — Per-IP rate-limit buckets key on the full IP; IPv6 /64 rotation evades them
Category A04 Insecure Design / rate-limit evasion (DoS). `apps/web/src/lib/rate-limit.ts:112-130` (`normalizeIp` returns full address) and every per-IP bucket (`getClientIp` :149-180; `preIncrementOgAttempt` :236-244; semantic/search/load-more/view buckets in `app/actions/public.ts`). An attacker controlling an IPv6 /64 (2^64 addresses) gets a fresh bucket per source address → bypass of DoS limits on expensive endpoints (POST /api/search/semantic = CLIP embed + up to SEMANTIC_SCAN_LIMIT=2000-row vector scan; searchImagesAction LIKE scans). Same-origin gate is not a control vs scripted attackers (Origin/Referer attacker-controllable outside a browser). Mitigations (why LOW): login brute-force bounded by account-scoped bucket `acct:<sha256>` which IP rotation does NOT evade; per-request work hard-capped. Confidence High (gap) / Med (impact). Fix: aggregate IPv6 to /64 prefix before keying buckets; keep IPv4 per-address.

### SEC-19-02 — Token-auth path verifies tokens against DB with no pre-DB IP rate limit (marginal)
Category A04 / unauthenticated DB-load amplification. `apps/web/src/lib/api-auth.ts:63-67` (token branch calls `verifyToken` before any rate-limit gate) → `apps/web/src/lib/admin-tokens.ts:136-159` (one indexed SELECT per well-formed token). Only unauthenticated-reachable /api/admin/* surface. Not brute-force (256-bit token; isWellFormedToken rejects malformed at zero DB cost; expensive multipart parse gated behind auth). DB-load amplification only. Confidence High (un-throttled) / Low (practical DoS). Needs-manual-validation against prod volume. Fix (optional): lightweight per-IP pre-increment in withAdminAuth before verifyToken when allowTokenScope set.

## Informational
SEC-19-INFO — CSP `style-src 'unsafe-inline'` (`lib/content-security-policy.ts:108` prod / :85 dev). script-src nonce-based with no unsafe-inline/eval. Common Next.js/Tailwind requirement; far lower impact than script. Not a vuln.

## Confirmed-clean (verified)
Auth wrapper, server-action CSRF (lint green), OG SSRF fail-closed host-pinned, file serving allowlist+symlink reject+realpath containment, LR token model (256-bit/SHA-256/constant-time/scope+expiry), privacy split compile-guards, injection prevention (Drizzle params + smart-collections allowlist compiler + LIKE escaping), DB restore scanner+lock+caps, output encoding (safe-json-ld/atom/CSV), session/login (HMAC+timingSafeEqual+Argon2 timing equalization+dual rate limit+session-fixation), proxy spoofing (TRUST_PROXY right-anchored XFF).

## Findings
- SEC-19-01 | LOW | High(gap)/Med(impact) | rate-limit.ts:112-130 — IPv6 /64 rate-limit evasion
- SEC-19-02 | LOW(marginal) | Low | api-auth.ts:63-67 → admin-tokens.ts:136-159 — token verify DB lookup un-throttled pre-DB
- SEC-19-INFO | INFO | — | content-security-policy.ts:108 — style-src unsafe-inline (note)
