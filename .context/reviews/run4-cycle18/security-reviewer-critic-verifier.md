# Run-4 Cycle 18 — security-reviewer / critic / verifier angle

Same inventory as the code angle (c17 regression set + feeds,
i18n-glue, micro-libs, CLIP, payments, settings/sharing rotation).
OWASP-lens pass over every rotated file; verifier sub-pass reproduced
each claim against source before it was accepted.

## Verifier: cycle-17 fix verification — CONFIRMED SOUND

- SEC-R4C17-01: grepped the live route — exactly 2 `rollbackOgAttempt(`
  occurrences, both above `getImageCached`; og contract suites assert
  the same; rate-limit docstring rewritten. The fix is complete and
  the lock is faithful.
- DES-R4C17-03/04 and COR-R4C17-05 verified as shipped (labels, toast,
  generic-key warnings — no value echo, satisfying the C15-MED-01
  never-echo contract).

## Findings

### SEC/COR-R4C18-02 (shared with code angle) — webhook FK 500-retry loop

Security framing: an attacker cannot trigger it (requires admin
deletion of a paid image), so this is availability/ops-correctness,
not an attack surface. The 500 path leaks nothing (generic "Database
error"). Endorse the 200-with-error-log fix; insist the log carries
`sessionId` + `amountTotalCents` so the manual-refund obligation is
discoverable. Verified: `event.data.object` is only trusted AFTER
`constructStripeEvent` signature verification — the deleted-image 200
cannot be used to probe image existence without a valid Stripe
signature.

### SEC-R4C18-04 — checkout post-DB refunds vs the new charged-failure doctrine (LOW-MED / Medium — DOCUMENT, not flip)

- `apps/web/src/app/api/checkout/[imageId]/route.ts:112,116,120,133` —
  `rollbackCheckoutAttempt(ip)` fires on `!image` (404 after a PK
  SELECT), non-paid tier, unprocessed, and unpriced — all post-DB.
  `api/search/semantic/route.ts:192,205` similarly refunds its two
  500 paths.
- This is the literal shape SEC-R4C17-01 eliminated on the OG photo
  route, and the rewritten `rollbackOgAttempt` docstring brands it "a
  free enumeration oracle with unmetered DB/CPU consumption".
- Critic adjudication — the cases genuinely differ; flipping checkout
  would be cargo-cult consistency:
  1. The checkout limiter's documented guarded resource is the
     **Stripe API budget** (rate-limit.ts:57-65); every refunded
     branch is one that never reached Stripe. The OG limiter guards
     route-local CPU/DB — the work the refunded branches had already
     consumed.
  2. The "oracle" reveals image existence / for-sale tier — both
     fully public on `/p/{id}` pages served unmetered at
     `revalidate = 0`. The OG concern included unmetered internal
     fetch amplification (10 s / 1 MB per size attempt), which has no
     checkout analogue (1-2 PK SELECTs).
  3. The Pattern-2 choice on checkout is deliberate and lineaged
     (C1RPF-PHOTO-HIGH-01, R4C6 COR-R4C6-08 test-locked for the DB
     -error path).
- BUT the divergence is currently explained NOWHERE a future
  route-author would look: the rate-limit.ts header (:1-31) still
  says "Three rollback patterns" and does not contain the charged
  -post-validation posture at all. That omission is exactly how the
  OG photo route drifted in the first place (DOC-R4C17-02 lineage).
- Disposition: fold into DOC-R4C18-03 — extend the canonical pattern
  header with Pattern 4 (charged post-validation; enumeration-oracle
  rationale; used by the OG buckets) AND a sentence naming why
  checkout/semantic deliberately remain Pattern 2 (guarded resource =
  Stripe API / embedding CPU, not the cheap pre-checks). No behavior
  change scheduled; severity preserved here so the decision is
  auditable.

### Verified non-findings (security sweep)

- **Topic feed locale hole (COR-R4C18-01)**: XML-injection angle
  checked — every sink passes through `escapeXml`; percent-encoded
  quotes in the locale segment cannot break attribute context.
  Residual is correctness + per-URL CDN cache-key growth (bounded by
  nginx URL length); endorse the 404 fix.
- Feed routes have no rate limit: GET routes are out of the
  public-route-rate-limit gate's scope by documented design; cost is
  3 bounded queries behind `s-maxage=1800` — consistent with the
  repo's unmetered public-page posture. Not a finding.
- `download-tokens.verifyTokenAgainstHash` — constant-time compare
  after shape checks; the indexed hash lookup is not a usable timing
  oracle (SHA-256 preimage). Sound.
- Download route: lstat→realpath→open→claim ordering verified; handle
  closed on all six failure paths; containment check uses resolved
  paths with separator suffix. Sound.
- Webhook: signature verified before ANY body trust; `payment_status`
  gate; zero-amount gate; tier allowlist; email shape + 255-byte cap;
  idempotency via SELECT + dup-key insertId disambiguation (R4C5
  verified-live semantics). Sound.
- `stripe.ts` lazy env validation — throws only when paid flows are
  exercised; no secret logging. Sound.
- `actions/sharing.ts` — admin-gated, same-origin-gated, dual-bucket
  rate limit with symmetric rollback; share keys 10-char base56
  (~58 bits) with collision retry; audit logs fingerprint (sha256/12)
  not the key. Sound.
- `actions/settings.ts` — allowlist keys, per-key validation, contract
  lock + active-claims check, transactional upsert. Sound.
- `audit.ts` purge: negative-retention guard (R4C6) present. Sound.
- `mysql-cli-ssl.ts` — `--ssl-mode=REQUIRED` for non-local hosts
  unless DB_SSL=false. Sound.
- `embedTextStub`/`embedImageStub` are pure hashing — no injection
  surface; semantic route is mode-gated to 'production' and stays 503
  in shipped config. Sound.
