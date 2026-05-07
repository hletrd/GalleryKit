# Security Reviewer — Cycle 9 (2026-04-25)

**HEAD:** `35a29c5`
**Scope:** All changes since cycle-8 baseline plus spot audit of touched and
adjacent security-sensitive surfaces (auth, sessions, file upload, CSRF,
rate-limiting, headers, CSP).

## Threat model coverage matrix

| Threat | Surface | Status this cycle |
|---|---|---|
| OG route DoS (CPU pin) | `/api/og` | **Closed** by AGG8F-01 (30 req/min/IP rate limit). |
| OG route cache poisoning | `/api/og` | **Mitigated** — Cache-Control success path is `public`; response derives only from `?topic=&tags=` query (validated) plus DB topic record + SEO settings. ETag covers all renderable inputs. |
| OG path-traversal / XSS via topic param | `/api/og` | **Closed** — `isValidSlug` (cycle 6/7 hardening) plus length cap. |
| OG XSS via tag param | `/api/og` | **Closed** — `isValidTagName` filter. |
| Sitemap DoS at build | `/sitemap.xml` | **Mitigated** — ISR + try/catch fallback (no 5xx that teaches crawlers to back off). |
| Sitemap DoS at runtime | `/sitemap.xml` | **Mitigated** — ISR (1h revalidate), `MAX_SITEMAP_URLS` cap. |
| Permissions-Policy drift | `/(.*)` headers | **Closed** by AGG8F-05 (next.config.ts + nginx/default.conf in lockstep). |
| Env knobs undocumented (operator misconfig) | `.env.local.example` | **Closed** by AGG8F-23 (5 knobs documented). |

## Findings

**Status: zero new findings of MEDIUM or higher severity.**

### S9-INFO-01 — OG `If-None-Match` header value is NOT timing-safe-compared (LOW / Low)
- **Citation:** `apps/web/src/app/api/og/route.tsx:79`
- **Why noteworthy:** `req.headers.get('if-none-match') === etag`. The ETag
  is a 32-char SHA-256 prefix of public inputs (slug + label + tags + site
  title); leaking 1 character at a time via timing is **not** a useful attack
  because the inputs are already public. The 304 response yields no secret
  state.
- **Action:** **DEFER**. Per OWASP, ETag comparison does not require
  constant-time matching when the ETag covers public content.

### S9-INFO-02 — OG cache-control on 304 path uses success cache-control (LOW / Low)
- **Citation:** `apps/web/src/app/api/og/route.tsx:82-83`
- **Why noteworthy:** correct — the 304 means the same cached entity is
  still valid. Recording for review trail completeness.

### S9-INFO-03 — Permissions-Policy directives appear in two nginx locations (LOW / Medium)
- **Citation:** `apps/web/nginx/default.conf:39, 110`
- **Why noteworthy:** AGG8F-14 from cycle 8 already flagged this as
  defense-in-depth. Both lists were updated in lockstep this cycle, which
  is the correct outcome. No regression.
- **Action:** **DEFER** (continued from cycle 8 deferred list).

## Surfaces re-checked (no findings)

- `lib/session.ts` — Argon2 / HMAC / timing-safe / cookie attrs all unchanged
  and remain correct.
- `lib/auth-rate-limit.ts` — DB-backed login rate-limit unchanged.
- `app/api/admin/db/download/route.ts` — withAdminAuth wrapper still in
  place (lint:api-auth confirms).
- `lib/csv-escape.ts` — Unicode bidi/invisible char strip from cycle 6/7
  unchanged.
- `lib/process-image.ts` — input-pixel caps unchanged.
- `proxy.ts` — admin auth guard unchanged.

## Summary

Cycle 8 hardening landed cleanly. No new vulnerabilities discovered. The
two MEDIUM cycle-8 findings (`/api/og` cache+RL, sitemap config) are
closed. Three INFO-level observations; all valid for deferral.
