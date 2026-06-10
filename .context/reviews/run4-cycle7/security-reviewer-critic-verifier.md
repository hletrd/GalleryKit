# Run-4 Cycle 7 — security-reviewer + critic + verifier angle

## Inventory & method
- OWASP-lens pass over the rotated surfaces (money path end-to-end:
  checkout → webhook → entitlement → download; smart-collection AST →
  SQL; sanitize/validation chain; public action rate-limit choreography).
- Verifier discipline: every claimed behavior below was traced to source
  or to vendored framework code (Next.js auto-implement-methods read in
  node_modules, not assumed from docs).
- Critic pass on the cycle-6 fixes and on this cycle's own proposed
  remediations (failure modes of the fixes themselves).

## Findings (security/abuse framing)

### COR-R4C7-01 / COR-R4C7-02 — single-use token consumable by third parties without possession of the asset (HIGH + MED-HIGH / High)
- Verified in vendored source: `auto-implement-methods.js` lines 39-46
  assigns the userland GET as the HEAD implementation. The download GET
  performs the claim; therefore ANY intermediary that issues HEAD or GET
  against a leaked/scanned link **denies service to the paying
  customer** (digital-goods DoS, no auth needed beyond seeing the URL).
  Mail-pipeline scanners see every emailed link by design — this is the
  expected deployment path per README, not an edge case.
- Note this is NOT a token-theft vector (scanner gets the bytes only on
  GET; with HEAD it burns the claim and gets nothing) — it is an
  integrity/availability defect on a paid flow.
- Remediation reviewed for new attack surface (critic):
  - Interstitial GET must NOT claim, must keep `no-store`, and must not
    reflect un-encoded request data. Render only server-derived values
    (image title from DB, HTML-escaped; the token only inside a hidden
    form field, HTML-attribute-escaped; it is already in the URL the
    client holds, so no new exposure class).
  - POST handler: keep identical validation taxonomy; the
    public-route-rate-limit gate will demand a pre-increment or a
    documented `@public-no-rate-limit-required` tag — the webhook
    precedent (cryptographic gate before DB work) applies: token shape
    check (regex) short-circuits forgeries before any DB probe, and the
    indexed hash lookup is the same cost the GET path already exposes
    publicly today. Either posture is defensible; prefer the documented
    exemption to avoid penalizing a customer's legitimate retry after a
    scanner 410.
  - The interstitial response should carry a restrictive inline CSP
    (`default-src 'none'; style-src 'unsafe-inline'; form-action 'self';
    base-uri 'none'`) because API routes are EXCLUDED from the proxy
    middleware matcher (verified `proxy.ts` line 140) and otherwise ship
    with no CSP at all.

### COR-R4C7-03 — validator/compiler trust boundary mismatch (MED / High)
- The module's own doctrine (R4C4 HARD-R4C4-07) is "malformed values
  must fail loudly at validation (write time)". Operators (`gt` on
  `tag`) currently fail at RENDER time on the public page instead. No
  injection risk (compile throws before SQL), but it converts an
  admin-side mistake into a public outage of that collection URL.
  Verified: `VALID_OPERATORS` has no per-column dimension; save actions
  call parse only; page maps compile-throw to notFound().

### Verified-clean (security)
- **Webhook**: signature verified before any DB work; payment_status
  gate; tier allowlist; zero-amount gate; email shape/length validation
  order (reject > 255 BEFORE slice); idempotency SELECT + dup-key
  insertId disambiguation — no bypass found.
- **Checkout**: pre-increment rate limit with rollback on EVERY
  early-return including both catch blocks (re-verified after cycle-6
  change); strict price parse; Stripe idempotency key deterministic
  per (image, ip, minute) — no amplification primitive found.
- **Download route**: path containment (`resolve` + `startsWith` +
  `realpath` + symlink lstat reject) intact; constant-time token
  comparison; stored-hash shape validation distinguishes corruption from
  forgery without oracle behavior (uniform 403).
- **Smart-collection SQL**: all values parameter-bound; LIKE
  metacharacters escaped; IN capped at 100; depth capped; non-scalar
  values rejected at validate AND would fail compile — no injection.
- **`x-gk-admin-render` (cycle-6)**: reflects the requester's own cookie
  presence only; pages are no-store so no cache-keyed cross-user leak;
  header absent on API routes (middleware matcher). No disclosure.
- **sanitize.ts / validation chain**: bidi/zero-width rejection contract
  consistent between test() (non-global) and replace() (global) regexes.
- **Public actions**: load-more/search/semantic rate-limit pre-increment
  + rollback choreography re-checked against the in-memory/DB dual
  authority — consistent.

## Critic notes on this cycle's fix shapes
- Interstitial adds one click for legitimate customers — accepted cost;
  it is the industry-standard mitigation, and the README documents the
  flow operators communicate to customers.
- `validateNode` tightening is a behavior change for any EXISTING stored
  query_json carrying an invalid tag operator: such rows were already
  broken (public 404), and the public page keeps its compile-throw →
  notFound guard, so no new failure mode is introduced; re-saving them
  now errors with the localized message instead of "succeeding".
- upload-dropzone `topicRef`: latest-wins matches the established tag
  semantics on the same surface; no security dimension.
