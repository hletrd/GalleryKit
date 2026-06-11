# Run-4 Cycle 18 — document-specialist angle

Sources checked against code: CLAUDE.md (lint gates, rate-limit
posture, paid-download notes), apps/web/README.md "Paid downloads"
references in route comments, rate-limit.ts header docstring, RFC
4287 / RFC 7232 conformance claims in atom-feed.ts /
feed-conditional.ts, schema comments.

## Findings

### DOC-R4C18-03 — rate-limit.ts pattern header is stale after SEC-R4C17-01 (LOW / High — SCHEDULE)

- `apps/web/src/lib/rate-limit.ts:1-31` opens with "Three rollback
  patterns are used across the codebase" and instructs: "When adding
  a new rate-limited action, choose the appropriate pattern."
- Cycle 17 introduced a FOURTH posture — charged-post-validation
  (rollback ONLY for pre-DB syntactic rejections; everything after
  stays charged, including infra errors) — but it is documented only
  inside the `rollbackOgAttempt` docstring (:224-237). A new
  rate-limited route's author reading the canonical header today is
  steered to Pattern 2 for any "public read path", which is precisely
  the doctrine the OG photo route wrongly followed for 17 cycles
  (DOC-R4C17-02 proved the header-level example propagates into code).
- Fix: add Pattern 4 to the header — name (charged post-validation /
  enumeration-oracle posture), rationale (AGG8F-01 / SEC-R4C17-01),
  which buckets use it (both OG buckets), and one sentence on why
  checkout + semantic deliberately remain Pattern 2 (their guarded
  resources are the Stripe API budget and embedding CPU respectively;
  the refunded branches never consume the guarded resource — see
  SEC-R4C18-04 in the security file). Pure comment change; no
  behavior.

### Doc-verification sweep — clean

- CLAUDE.md "Lint Gates" DOES list
  `npm run lint:public-route-rate-limit` (line ~480) with its fixture
  test — an earlier hypothesis that it was missing is FALSE
  (verified against the working tree; the abbreviated system copy had
  truncated the section).
- atom-feed.ts RFC claims spot-checked: `atom:name` is a Person
  construct (no `type` attr) — correct per RFC 4287 §3.2; feed-level
  `<author>` satisfies §4.1.1; `<rights>` §4.2.10; explicit
  `type="text"` is the §3.1.1 default made explicit. Conformant.
- feed-conditional.ts RFC 7232 §3.3 second-precision claim matches
  the implementation (floor-to-seconds on both sides, `>=` compare).
- Webhook route's `@public-no-rate-limit-required` and download
  route's exemption paragraphs accurately describe their gating
  (signature / 256-bit bearer token) — verified against the lint
  script's strip-then-match semantics (tag kept quote-free as its own
  NOTE instructs).
- `clip-inference.ts` stub warnings and the semantic route's
  "rejects when mode is not production" claim match the 503 gate at
  route.ts:169-174.
- schema.ts entitlements FK comment-free cascade matches the US-P54
  comments elsewhere; the COR-R4C18-02 fix should NOT change the
  schema, only the webhook's handling (the cascade is the documented
  design).
- CLAUDE.md does not document feed routes anywhere it would now be
  wrong; no CLAUDE.md edit required this cycle (DOC-R4C13-01/02
  standing deferral untriggered — neither gated section was edited).
