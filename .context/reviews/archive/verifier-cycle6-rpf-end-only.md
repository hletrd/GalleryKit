# verifier — Cycle 6 RPF (end-only)

## Method

Verify cycle 1-5 RPF claims still hold in current source. Read each
claim's anchor file and grep for the cycle-marker comments.

## Gate baseline

- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run lint:api-auth` — clean.
- `npm run lint:action-origin` — clean.
- `npm test` — 979 passed (110 files).
- `npm run build` — clean (build artifacts present, route table prints).
- Workspace status: clean on master, 15 commits ahead of origin.

## Cycle 1-5 carry-forward verification

### Cycle 1 RPF (plan-100 / cycle 1 fresh)
- **C1RPF-PHOTO-HIGH-01** — checkout per-IP rate limit. Verified in
  `apps/web/src/app/api/checkout/[imageId]/route.ts:62` (preIncrement)
  and `apps/web/src/lib/rate-limit.ts:271` (function defined).
- **C1RPF-PHOTO-MED-01** — webhook PII redaction in error logs.
  Verified at line 169-174 (no customerEmail in structured object).
- **C1RPF-PHOTO-MED-02** — tier allowlist in `lib/license-tiers.ts`.
  Verified at line 17.

### Cycle 2 RPF (P260)
- **C2-RPF-01** — opt-in plaintext token log via
  `LOG_PLAINTEXT_DOWNLOAD_TOKENS`. Verified at webhook line 313.
- **C2-RPF-03** — EMAIL_SHAPE regex. Verified at line 46.
- **C2-RPF-13** — `mapStripeRefundError` mapping table. Verified at
  sales.ts line 121.

### Cycle 3 RPF (P262)
- **C3-RPF-01** — gate `session.payment_status === 'paid'`. Verified
  at webhook line 88.
- **C3-RPF-02** — zero-amount session reject. Verified at line 228.
- **C3-RPF-03** — UPLOAD_DIR_ORIGINAL usage. Verified at download
  route line 99.
- **C3-RPF-04** — Content-Disposition extension sanitization. Verified
  at download route line 185-187.
- **C3-RPF-05** — file-existence check before atomic claim. Verified
  at download route line 125-153.
- **C3-RPF-07** — webhook idempotency via SELECT-then-INSERT.
  Verified at line 249-260.
- **C3-RPF-09** — email lowercase post-truncation. Verified at
  webhook line 155.

### Cycle 4 RPF (P264)
- **C4-RPF-01** — slice email to 255. Verified at webhook line 155.
- **C4-RPF-02** — tier mismatch warn-only log. Verified at line
  211-218.
- **C4-RPF-03** — async-paid log severity split. Verified at line
  88-99 (warn for unpaid, error for unexpected).
- **C4-RPF-05** — trim email before EMAIL_SHAPE. Verified at line 132.
- **C4-RPF-06** — parallelize realpath calls. Verified at download
  route line 136-139.
- **C4-RPF-07** — StripeRateLimitError → network. Verified at sales.ts
  line 143.
- **C4-RPF-08** — refund button text doesn't rotate. Verified at
  sales-client line 268.
- **C4-RPF-09** — error load alert role. Verified at sales-client
  line 191.

### Cycle 5 RPF (P388 / P266)
- **C5-RPF-01** — refund Idempotency-Key. Verified at sales.ts line
  187-190 (`idempotencyKey: \`refund-${entitlementId}\``).
- **C5-RPF-02** — structured-object log shape on idempotent skip +
  entitlement created. Verified at webhook lines 258, 312.
- **C5-RPF-03** — auth-error split. Verified across:
  - `RefundErrorCode` union (sales.ts:115)
  - `mapStripeRefundError` (sales.ts:137)
  - `mapErrorCode` switch (sales-client.tsx:119)
  - en.json:731, ko.json:705
  - page.tsx:48
- **C5-RPF-04** — EMAIL_SHAPE module-scope. Verified at webhook line
  46 (BEFORE `export async function POST` at line 48).
- **C5-RPF-05** — non-Error throw handling. Verified at sales.ts
  line 128-130 (BEFORE the instanceof check at line 131).
- **C5-RPF-06** — 256+-char raw email reject. Verified at webhook
  line 133-140.
- **C5-RPF-07** — source-contract tests. File present and asserts pass
  in vitest run.

## Conclusion

All cycle 1-5 RPF claims verified intact in current source. Test suite
979/979 green. All gates green. Workspace clean.

Cycle 6 has 7 new findings (5 across-agent agreements + 2 individual
findings) suitable for a small fix pass.
