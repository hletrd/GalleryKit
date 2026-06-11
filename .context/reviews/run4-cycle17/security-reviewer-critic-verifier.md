# Security-reviewer + critic + verifier — Run-4 Cycle 17

Single-subagent in-context pass (documented run-wide constraint).
OWASP-oriented sweep over the rotation surfaces + verification of the
cycle-16 security-relevant commit (`61d85a05` CSP).

## Findings

### SEC-R4C17-01 — the two OG routes ship test-locked CONTRADICTORY rate-limit policies; the per-photo route refunds post-DB and post-fetch failures
- **Files:**
  - `apps/web/src/app/api/og/photo/[id]/route.tsx:83` (`!image` →
    `rollbackOgAttempt(ip)` AFTER `getImageCached` DB work),
    `:116` (`!fetched` → rollback AFTER DB work + up to
    |imageSizes| ≤ 8 internal HTTP fetch attempts × 10 s timeout × 1 MB
    buffer cap each), `:221` (catch → rollback after potentially
    Satori/Sharp CPU).
  - `apps/web/src/app/api/og/route.tsx:67-74` — the SIBLING route
    deliberately keeps the post-DB 404 **charged**, with the explicit
    comment: "Nonexistent topic probes still consume public DB work and
    otherwise become a free topic-enumeration oracle."
  - Both policies are LOCKED by tests that contradict each other:
    `__tests__/og-route-source-contracts.test.ts:9` asserts the topic
    route contains NO `rollbackOgAttempt`;
    `__tests__/og-photo-fallback.test.ts:53-57` asserts the photo route
    rolls back in ≥ 4 places including the `!fetched` branch.
- **Severity/Confidence:** MED / High. CONFIRMED (both sources +
  both locking tests read; lineage traced: `3c2cc3aa` C7-SEC-01 added
  the photo-route rollbacks; AGG8F-01/plan-233 later established the
  charged-404 policy on the topic route and the lock test, and the
  photo route was never reconciled).
- **Why it is a problem:** the rate limit on `/api/og/photo/[id]`
  binds ONLY for fully successful generations — which are exactly the
  responses that are CDN-cacheable. Every failure mode is refunded:
  - Nonexistent-id probes: unlimited un-rate-limited DB lookups
    (`getImageCached` per id) — the exact "free enumeration oracle +
    unmetered DB load" the sibling route's comment forbids.
  - Legacy photo in a backfill window (`!fetched`): each request
    consumes 3 DB reads + up to 8 internal loopback fetches (each up
    to 10 s / 1 MB) and is then refunded — an attacker who finds one
    such id gets an unmetered internal-fetch amplifier.
  - Persistent server-side errors (corrupt derivative → Sharp throw):
    refunded retry storms.
- **Concrete failure scenario:** scripted abuser walks
  `/api/og/photo/1..10^7`. Valid processed ids cost a charged attempt;
  the overwhelming majority (missing ids) are refunded, so the 30/min
  budget never trips and the DB eats the full probe rate. The
  `preIncrementOgAttempt` gate exists specifically to prevent this and
  is structurally bypassed.
- **Fix:** keep `rollbackOgAttempt` ONLY on the two pre-DB syntactic
  validation rejections (`route.tsx:63`, `:68` — genuinely zero work
  consumed); DELETE the rollbacks on the `!image`, `!fetched`, and
  catch paths so post-DB work is charged, matching the sibling route's
  documented policy. Update `og-photo-fallback.test.ts` to lock the NEW
  contract (exactly 2 rollbacks, both above the DB call; negative
  assertions that the three post-DB branches do not refund) — a
  deliberate, documented contract flip, not test-masking. Fix the
  `rollbackOgAttempt` docstring in `lib/rate-limit.ts:224-228` whose
  example ("e.g., topic not found") contradicts the shipped+locked
  topic-route behavior (DOC-R4C17-02 folds in here).
- **Critic angle (fix-shape):** do NOT add new rate-limit machinery or
  split buckets per route; the shared `og` bucket is correct (both
  routes guard the same CPU class). The change is deletion + test
  re-lock + docstring. Resist the temptation to also charge the
  pre-parse rejections — refunding zero-cost syntactic 400s is
  harmless and keeps unfurl-bot UX unaffected.
- **Verifier evidence:** `grep -n rollbackOgAttempt` over both routes;
  `git log -L` on the `!image` hunk (rollback introduced `3c2cc3aa`);
  `rate-limit.ts:213-236` pre-increment/rollback implementation read;
  both lock tests read in full.

## Verified clean (verifier pass)

- `61d85a05` CSP change: GA4 wildcard host set matches Google's
  documented analytics-tier contract; no advertising hosts; nonce
  unshift order preserved; dev CSP untouched.
- `request-origin.ts`: TRUST_PROXY-gated right-most-hop forwarded
  header parsing; default-port stripping; fail-closed
  `hasTrustedSameOrigin` (C1R-01). Correct.
- `sanitize.ts`: stateful-`/g`-regex pitfall handled (C8-AGG8R-01);
  null-on-rejection contract uniform (C13-MED-01/C15-MED-01); stderr
  credential redaction layered. Correct.
- `actions/seo.ts`: same-origin guard + maintenance gate + per-field
  Unicode rejection + allowlisted keys + codepoint length checks +
  `validateSeoOgImageUrl` relative/same-origin restriction +
  transactional upsert + audit. Correct.
- `actions/tags.ts`: every mutator carries
  isAdmin + requireSameOriginAdmin + maintenance gate; ids validated;
  batch caps (100); INSERT IGNORE / affectedRows audit-gating. Correct
  (one non-security warning asymmetry → COR-R4C17-05, filed by code
  angle).
- `actions/admin-backfill.ts`: gate order (isAdmin → origin) correct;
  audit on queued only; status getter exempt-commented as read-only.
- `auth-rate-limit.ts`: dual in-memory/DB buckets, decrement-not-delete
  rollback (C1-07), account-scoped keys. Correct.
- OG topic route: param validation before rate-limit charge; post-DB
  404 charged; ETag input is derived from validated/clamped values.
- `og/photo` `sanitizeForOg`: strips bidi/invisible + C0 — defense in
  depth intact. `buildFallbackResponse` Location is admin-validated
  (`validateSeoOgImageUrl`) or same-origin root.
- `db/index.ts`: TLS for non-localhost unless DB_SSL=false;
  `rejectUnauthorized: true`. Correct.
- Secrets sweep over rotation files: none.

## Risks needing manual validation (not findings)
- `og/photo` internal fetch origin derives from `req.url` (Host
  header). Behind the documented nginx + TRUST_PROXY topology the host
  is normalized; a direct-to-container forged Host could point the
  loopback fetch at an attacker host (fixed path suffix, GET only,
  response embedded as image). Topology makes this LOW; the deferred
  PERF-R4C17-06 disk-read refactor would eliminate the class. Recorded
  with the deferral, not as a standalone finding.
