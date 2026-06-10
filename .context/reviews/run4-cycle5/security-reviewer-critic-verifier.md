# Security-reviewer + critic + verifier — Run-4 Cycle 5

Angle: OWASP Top 10, authn/authz, unsafe patterns, secrets, plus
adversarial critique and evidence-based verification of claims.

## Inventory

- Admin DB surfaces: `db-actions.ts` (backup/restore/CSV, full),
  `api/admin/db/download/route.ts` (full) incl. `isValidBackupFilename`
  header-injection check.
- Anonymous server-action surface: `actions/public.ts` (full — rate
  limits, rollback symmetry, validation), `actions/collections.ts` (full),
  `actions/embeddings.ts` (full).
- Mutating admin actions: `settings.ts`, `seo.ts`, `topics.ts`, `tags.ts`
  (update/delete), `sharing.ts` (revoke/delete) — origin-guard + isAdmin
  posture.
- Public emission surfaces: `feed.xml` (XML escaping), `sitemap.ts`,
  `api/og/photo/[id]` (sanitizeForOg, rate limit, fallback redirects).
- Regression review of R4C4 commits from the security angle (token
  minting guard, refund convergence authz surface, LR containment quota
  accounting, download claim ordering).
- Gate integrity: all three scanners' baseline PASS verified from logs.

## Findings

### SEC-R4C5-02 — Dead `getSmartCollections` server action: unauthenticated endpoint returning PRIVATE collections — LOW-MED / Confidence: High
- **File:** `apps/web/src/app/actions/collections.ts:119-124`.
- `'use server'` makes every export of this file a POST-invokable server
  action. `getSmartCollections()` carries
  `@action-origin-exempt: read-only — no mutation, no auth required for
  public listings` yet does `db.select().from(smartCollections)` — ALL
  columns (`query_json`, `is_public`) for ALL rows **including
  `is_public = false` collections**, with no `isAdmin()` gate and no
  rate limit. The public collection page correctly 404s private
  collections (`c/[slug]/page.tsx:82-84`); this action would enumerate
  them (names, slugs, full filter ASTs) to anyone holding the action ID.
- **Mitigating reality (why LOW-MED, not HIGH):** grep proves ZERO
  callers — the action ID is therefore not referenced from any client
  chunk, so an attacker cannot currently look the ID up in shipped JS;
  Next.js action IDs are non-guessable build hashes. The exposure arms
  the moment any client component imports it (e.g. a future admin
  collections manager UI built on this getter "because it already
  exists").
- **Critic's framing:** this is exactly the failure shape the
  action-origin scanner exists to prevent, and the exempt comment is
  FALSE as written ("public listings" — the query returns private rows).
  The scanner cannot catch it because the body is genuinely read-only.
- **Fix:** delete the dead export (smallest surface). If a listing getter
  is ever needed: admin variant must gate on `isAdmin()`; public variant
  must filter `is_public = true` and omit `query_json`.

### SEC-concur on I18N-R4C5-03 (designer-raised) — raw `e.message` across the action boundary
- `collections.ts:33,78` return `e.message` from the smart-collection
  parser (controlled English strings — no internals, i18n problem only),
  but `embeddings.ts:112-113` returns RAW `err.message` from an arbitrary
  caught error — a DB failure mid-backfill can carry driver/SQL fragments
  to the client. Audience is authenticated admins only (low exposure),
  and the repo's posture since C6-RPF-03 (sales) and R4C4-05 (lr-tokens)
  is: generic localized error across the boundary, detail in server logs.
  Concur with scheduling; severity LOW.

## Verified (evidence-based)

- `isValidBackupFilename` regex `^backup-\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-[0-9a-f]{8})?\.sql$`
  admits no `"` / `;` / path chars → `Content-Disposition` interpolation
  in `db/download/route.ts:82` is injection-safe; containment +
  lstat-symlink + realpath checks all present; streams from the resolved
  path (TOCTOU closed).
- Backup/restore spawn env: `MYSQL_PWD` (not argv), `HOME` excluded,
  stderr through `sanitizeStderr` with password/user/host/name redaction.
- Restore: 250 MB cap, header validation reads only `bytesRead`,
  dangerous-SQL chunk scan with tail-carry, advisory-lock discipline with
  early-return releases — all verified in-source this cycle.
- Anonymous surface rate limiting: search (in-memory + DB, symmetric
  rollback), load-more (both actions), view recording (120/min bounded
  maps), OG routes (30/60s with rollback on every non-success path).
  Smart-collection load-more shares the load-more budget — no unmetered
  path found.
- All four R4C4 security-adjacent fixes hold under adversarial re-read:
  the Enter-guard cannot be bypassed by IME composition (guard is in
  `handleCreate` itself, not just the key handler); refund convergence
  cannot be reached without `isAdmin()` + same-origin; LR containment
  cannot double-settle (guard flag verified); download claim ordering
  leaves the token intact on every pre-claim failure.
- Secrets sweep over the cycle-4 diff: no credentials, no tokens, no new
  env reads. `messages/*.json` diffs are UI strings only.
- Scanners: `lint:api-auth`, `lint:action-origin`,
  `lint:public-route-rate-limit` all PASS on the clean tree (logs
  captured in this cycle's gate baseline).

## HARD-SCOPE check
No finding proposes edit/culling/scoring features. Nothing here expands
product surface; SEC-R4C5-02's fix REDUCES surface.
