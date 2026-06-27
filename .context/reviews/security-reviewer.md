# Security Review Report — Cycle 18

**Scope:** all server actions, all API routes, auth/session primitives, SQL-construction surfaces, input/output rendering (JSON-LD, OG, CSV), file upload + path serving, CSP/middleware, dependency audit.

**Risk Level: LOW** — 0 CRITICAL / 0 HIGH / 0 MEDIUM. Two LOW/informational items. Validated from code, not comments.

## OWASP Top 10 — all PASS
A01 Broken Access Control (withAdminAuth + isAdmin server-side + requireSameOriginAdmin, lint-gate enforced); A02 Crypto (Argon2id 64MiB/t3/p4, HMAC-SHA256 + timingSafeEqual, SESSION_SECRET mandatory ≥32 in prod); A03 Injection (Drizzle params, smart-collection allowlists + scalar enforcement, LIKE escaping, safeJsonLd, spawn array-args); A04 Insecure Design; A05 Misconfig (strong CSP nonce, no unsafe-inline/eval in prod, object-src none, base-uri self, nosniff, no-store admin/API); A06 (`npm audit --omit=dev`: **0 vulnerabilities**); A07 Auth (dual-bucket per-IP+per-account rate limit, dummy-hash timing equalization, generic error, 24h token age bound); A08 Integrity (DB restore header validation + advisory lock + --one-database, backup realpath containment); A09 Logging (logAuditEvent, password-redacted mysqldump stderr); A10 SSRF (OG self-fetch pins origin to trusted siteConfig.url, fail-closed, 10s timeout + 1MB cap).

## Priority-area verification
- **Public search routes (semantic, similar/[id]) — architect PII flag CLEARED.** Both enrichment selects return only `id, title, description, filename_jpeg, width, height, topic, topics.label, camera_model, lens_model, capture_date` — none in `_PrivacySensitiveKeys`. No GPS/filename PII reaches the response. Both enforce same-origin, restore-maint gate, body/Content-Type/chunked guards, rate-limit pre-increment + rollback.
- **Admin API routes** wrap withAdminAuth (`lint:api-auth` passes).
- **LR PAT token** — `gk_`+base64url(32 bytes); only SHA-256 digest persisted; verifyToken well-formed-gated, parameterized lookup, timingSafeEqual, expiry-enforced, fail-closed.
- **File upload security** — lr/upload mirrors browser path (filename sanitize, slug, sanitizeAdminString + code-point caps, restore-maint, contract lock, bavail disk pre-check, GPS strip DB+on-disk, HDR gating, idempotent quota settle).
- **Path traversal** — serve-upload + db/download use segment allowlist + realpath containment + lstat symlink reject (TOCTOU closed).
- **Cycle-17 changes** — semantic-mode snapshot is a pure config hoist (no security impact); upload-tracker settle-on-throw prevents a quota-claim leak DoS (correct, no new surface).

## Findings

### LOW-1 — Enrichment selects in search routes lack a compile-time PII guard (defense-in-depth)
`api/search/semantic/route.ts:293-315`; `api/search/similar/[id]/route.ts:194-216`
**No live leak today** (columns verified public). Unlike publicSelectFields/searchFields, these hand-written object-literals have no `Extract<keyof, PrivacySensitiveKeys>` compile guard. A future edit adding e.g. `latitude` ships to anonymous callers with zero tsc/test signal (a runtime test exists since bdf6fcdb; a compile twin would catch at tsc). Fix = mirror `_searchPrivacyGuard` or build from a shared guarded const. Confidence High that current code is clean. (Same root as architect A2 / critic MAJOR-3.)

### LOW-2 — CLAUDE.md doc drift on LR token header + format
CLAUDE.md says "32-char random hex" in `X-Admin-Token`. Code uses `X-GalleryKit-Token` (`TOKEN_HEADER='x-gallerykit-token'`) and `gk_`+base64url(32 bytes). Implementation is STRONGER than documented; doc-only fix.

## Checklist (all ✓)
No hardcoded secrets; inputs validated; injection prevented; authZ verified; session crypto verified; SSRF fail-closed; XSS (CSP nonce + safeJsonLd + Unicode strip); path traversal closed; rate limiting verified; dependencies 0 vulns.

**`npm audit --omit=dev`: found 0 vulnerabilities.**
**Lint gates api-auth / action-origin / public-route-rate-limit: all PASS.**
