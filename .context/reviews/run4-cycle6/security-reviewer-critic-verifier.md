# Run-4 Cycle 6 — security-reviewer + critic + verifier angle

Inventory: anonymous API surface (`api/search/semantic`, `api/checkout`,
`api/download` catch-region recheck, `api/stripe/webhook` gate recheck),
`proxy.ts` middleware guard, `lib/auth-rate-limit.ts`,
`next.config.ts` security headers, `nginx/default.conf`,
`public/sw.template.js` (full), `app/robots.ts`, `app/manifest.ts`,
`lib/audit.ts`, semantic-route enrichment field set vs
`publicSelectFields`, schema privacy-flag census (`is_public`,
`map_visible`), LIVE production verification against
https://gallery.atik.kr (HTML cache-control, derivative cache-control +
ETag, security headers).

## LIVE production probes (verifier)

```
GET /en                  → cache-control: private, no-cache, no-store, max-age=0, must-revalidate
GET /en/p/1              → cache-control: private, no-cache, no-store, max-age=0, must-revalidate
GET /uploads/jpeg/<f>.jpg→ cache-control: public, max-age=0
                           etag: W/"72e6e-19e0c0562c0"   (Next static size-mtime shape)
                           x-content-type-options: nosniff (from next.config headers())
```

These three lines kill two assumptions the codebase documents as fact —
see COR-R4C6-05 and ARCH-R4C6-06 (recorded in the perf/architect file;
security facets below).

## Findings (security facets)

### COR-R4C6-05 (security facet) — sw.template.js `hasAdminSession()` reads a forbidden header: the guard is dead code
- **Severity/Confidence: MED (as part of the dead-HTML-cache cluster) / High**
- **File:** `apps/web/public/sw.template.js:53-56`, used at `:208`
- `request.headers.get('Cookie')` inside a Service Worker fetch handler
  is ALWAYS null: `Cookie` is a Fetch-spec forbidden header name, filtered
  from the `Request` object exposed to JS; the browser attaches cookies
  at the network layer after the SW. The "never cache HTML rendered for
  an admin session" protection therefore does not exist.
- Today this is masked by the larger dead-cache fact (every public HTML
  page carries `no-store`, so `isSensitiveResponse` blocks all HTML
  caching anyway — production-verified above). The moment anyone "fixes"
  offline caching without noticing the dead guard, admin-rendered pages
  (which DO vary: `isAdmin` gates GPS coordinates in the photo viewer)
  would land in Cache Storage.
- **Fix (with the cluster):** middleware sets a response header (e.g.
  `x-gk-admin-render: 1`) when the request carries an `admin_session`
  cookie (`proxy.ts` already reads request cookies); the SW checks the
  RESPONSE header instead of the unreadable request Cookie. The header
  only reflects the requester's own cookie back to the same client — no
  cross-user information disclosure.

### Semantic search enrichment — verified within the public field contract
`api/search/semantic/route.ts:235-265` returns `title, description,
filename_jpeg, width, height, topic, topic_label, camera_model` for
`processed = true` rows. Cross-checked against `publicSelectFields`
(every returned column is public there) and the schema: topics carry NO
visibility flag (only `map_visible`, which gates GPS map inclusion, and
smart-collection `is_public`, not used here). No private-surface leak.
Endpoint remains stub-gated (`semanticSearchMode !== 'production'` →
503) and the stub is documented as such.

### Checkout route Pattern-2 asymmetry (security-adjacent)
See COR-R4C6-08 in the code angle: DB reads outside the try mean a DB
outage consumes the visitor's per-IP budget without rollback. DoS-ish
self-inflicted lockout during infra blips; fix is mechanical.

### Atom `<name type="text">` — standards conformance
See STD-R4C6-09 in the document-specialist file: RFC 4287's RELAX NG
defines `atomPersonConstruct` with `element atom:name { text }` and NO
`type` attribute; `type="text"` on `<name>` is schema-invalid (the
R18-L2 advisory-silencing change overshot from Text constructs onto a
Person construct). Validator noise, not exploitable.

## Verified clean (this angle)
- `proxy.ts` matcher excludes `/api` — every `/api/admin` route carries
  `withAdminAuth` (lint:api-auth green at baseline); action-origin and
  public-route-rate-limit scanners green at baseline.
- Login/account/password rate-limit buckets: bounded maps, decrement
  rollbacks, DB-backed source of truth — no regression since R4C1.
- `robots.ts` disallows `/admin`, locale-prefixed admin, `/api/`.
- Security headers on every response in production (verified live):
  nosniff, SAMEORIGIN, Referrer-Policy, Permissions-Policy, HSTS.
- Stripe webhook insert gate re-verified logically post-f2ab0034
  (conjunction excludes both loser shapes).
- `audit.ts` metadata never interpolated into SQL; JSON-stringified and
  bounded.
- e2e origin-guard spec still pins same-origin enforcement for actions.
- No new secrets, no plaintext-credential writes, no eval/dangerous DOM
  sinks introduced since cycle 5 (`dangerouslySetInnerHTML` usages remain
  the audited safeJsonLd call sites).

## Critic notes
- The cycle-5 smart-collection fix added cursor support but the action
  still accepts legacy numeric offsets up to 10 000 — fine, but the cap
  comment ("Cursor-based calls are preferred") would read better with a
  pointer to the client emitter; not a defect.
- `clampSemanticTopK` exported from a route file purely for tests —
  works, but a lib home would be cleaner; not worth churn this cycle.
- The repo keeps THREE cache policies for one resource class (see
  ARCH-R4C6-06) — the critic angle endorses unifying on the
  serve-upload semantics (rewrite-in-place-safe) rather than nginx's
  `immutable 1y`, which is provably wrong for a system whose backfill
  re-encodes bytes under unchanged filenames.
