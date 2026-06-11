# Run-4 Cycle 11 — security-reviewer / critic / verifier angle

## Inventory
- Paid surface re-read end-to-end: `api/checkout/[imageId]`, `api/download/[imageId]`,
  `actions/sales.ts` (refund + listEntitlements), `lib/download-tokens` shape gate.
- Public unauthenticated surfaces: `api/og/photo/[id]`, `lib/og-photo-fetch.ts`,
  `lib/rate-limit.ts` (all pre-increment/rollback helpers), `actions/collections.ts`
  (smart-collection save → public `/c/[slug]` compile path).
- Privacy parser re-verify: `gps-exif-strip.ts` post-EOI fix + `analytics.ts`
  (IP→country only, referrer TLD+1, private-IP/onion → 'direct').
- Auth/admin: `deleteAdminUser` audit detach + `audit_log` FK surface.

## Verifier results

- **GPS post-EOI trailer fix (SEC-R4C10-01) — VERIFIED COMPLETE.** The
  single-image walker now returns `null` on a non-trivial post-EOI trailer,
  so `stripGpsFromOriginal` tier-2 re-encodes the primary still and drops the
  embedded secondary's GPS. EOI-marker uniqueness in entropy data confirmed;
  progressive-JPEG safe. No bypass found.
- **Admin-delete audit detach (COR-R4C10-01) — VERIFIED COMPLETE.** Confirmed
  via schema read that `audit_log.target_id` carries no FK, so the single
  `UPDATE audit_log SET user_id=NULL` fully unblocks the delete. No residual
  errno-1451 path.
- **Smart-collection compiler — no SQLi.** All values flow through Drizzle
  binding / `inArray`; `contains` escapes `%_\`; `isScalarValue` rejects
  object/array/NaN values at write-time validation (HARD-R4C4-07). The tag
  subquery is parameter-bound. Column allowlist enforced twice (validate +
  compile).
- **Checkout/download rate-limit taxonomy — correct.** Every 4xx early-return
  rolls back the pre-incremented budget (Pattern 2); the success path does
  not. OG photo route rolls back on every non-generation return and not on
  success. Idempotency keys are deterministic (no randomness).

## Observation (no security finding)
- OG photo route fetches `${new URL(req.url).origin}/uploads/jpeg/<uuid>_NNN.jpg`.
  `origin` derives from the request host; with `TRUST_PROXY` the host is set
  by the reverse proxy. The fetched bytes are only embedded in the requester's
  OWN OG card and capped at 1 MB with a 10s timeout — not a usable SSRF/egress
  primitive. Pre-existing, reviewed in c4/c5. No action.

## Cross-angle
The only scheduled finding this cycle (**COR-R4C11-01**, view-count flush
stale-timer stranding) is a correctness/availability defect on best-effort
analytics, not a security or data-integrity issue. No CRIT/HIGH/MED security
findings. The two c10 privacy/correctness fixes hold under adversarial
re-trace.
