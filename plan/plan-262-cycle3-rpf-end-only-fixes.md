# Plan 262 — Cycle 3 RPF (end-only) in-cycle fixes

Status: in-progress

Source: `.context/reviews/_aggregate-cycle3-rpf-end-only.md`

Repo policy basis: AGENTS.md (commit + push everything; gitmoji), CLAUDE.md, user-global rules (signed gitmoji conventional commits, fine-grained, no `Co-Authored-By`, no `--no-verify`).

## In-cycle items

### Correctness / data-integrity (HIGH)

- [ ] **P262-01 / C3-RPF-01** — Gate webhook on `session.payment_status === 'paid'`. Add guard between signature verify and INSERT. Log `console.warn` with `sessionId` + `paymentStatus`. Citation: `apps/web/src/app/api/stripe/webhook/route.ts:57-94`. Reviewers: code-reviewer HIGH-01, security-reviewer HIGH-01, critic CRITIC-01, debugger DBG-HIGH-01, tracer TR-H1.

- [ ] **P262-02 / C3-RPF-02** — Reject `amountTotalCents <= 0` at webhook. Add guard with `Number.isInteger` check. Log `console.warn`. Citation: `apps/web/src/app/api/stripe/webhook/route.ts:69`. Reviewers: code-reviewer HIGH-02, security-reviewer HIGH-02.

### Correctness (MEDIUM)

- [ ] **P262-03 / C3-RPF-03** — Replace hardcoded `path.resolve(process.cwd(), 'data', 'uploads', 'original')` in download route with `UPLOAD_DIR_ORIGINAL` from `@/lib/upload-paths`, so the route honors `UPLOAD_ORIGINAL_ROOT` env var. Citation: `apps/web/src/app/api/download/[imageId]/route.ts:120-121`. Reviewers: critic CRITIC-09, tracer TR-M2, document-specialist DOC-MED-02, architect ARCH-LOW-04.

- [ ] **P262-04 / C3-RPF-04** — Sanitize `Content-Disposition` filename: restrict ext to `[a-zA-Z0-9.]` and length-cap to 8 chars before interpolation. Citation: `apps/web/src/app/api/download/[imageId]/route.ts:142-148`. Reviewers: code-reviewer MED-03, security-reviewer MED-01.

- [ ] **P262-05 / C3-RPF-05** — Move `lstat` and `realpath` checks BEFORE the atomic single-use claim (UPDATE with `downloadedAt`/`downloadTokenHash: null`). If file missing → 404 without consuming token. If OK → claim then stream. Citation: `apps/web/src/app/api/download/[imageId]/route.ts:90-160`. Reviewers: code-reviewer MED-04, security-reviewer MED-04, tracer TR-M1.

- [ ] **P262-06 / C3-RPF-06** — Delete dead `getTotalRevenueCents` action; remove import + Promise.all arm in `page.tsx`; drop `totalRevenueCents` prop in `sales-client.tsx`; recompute revenue from rows directly (already done client-side; remove the fallback). Citation: `apps/web/src/app/actions/sales.ts:75-91`, `page.tsx:10-13`, `sales-client.tsx:54,150-152`. Reviewers: code-reviewer MED-02, critic CRITIC-05, perf-reviewer PERF-MED-01, architect ARCH-LOW-02, debugger DBG-LOW-04.

- [ ] **P262-07 / C3-RPF-07** — Stripe-retry idempotency for the manual-distribution log line. Use Drizzle's MySQL insert-result `affectedRows` (1 = fresh insert, 2 = ON DUPLICATE KEY UPDATE) to skip token-generation/log on retries. Re-order: SELECT existing row first; if exists, return early without generating a token. Citation: `apps/web/src/app/api/stripe/webhook/route.ts:126-163`. Reviewer: tracer TR-M4.

- [ ] **P262-08 / C3-RPF-08** — Change row Refund button from `variant="destructive"` to `variant="outline"`; keep AlertDialog confirm action as destructive. Citation: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:206-217`. Reviewers: designer DSGN-MED-01, critic CRITIC-03.

### LOW

- [ ] **P262-09 / C3-RPF-09** — Lowercase `customerEmail` (after slice, before EMAIL_SHAPE check + INSERT). Citation: `apps/web/src/app/api/stripe/webhook/route.ts:66-67`. Reviewer: security-reviewer LOW-02.

- [ ] **P262-10 / C3-RPF-10** — i18n `errorLoad` so Korean users see Korean error string instead of server English. Add `errorLoad` key to `en.json` + `ko.json` "sales" section. In `page.tsx`, when `salesResult.error` truthy pass `t('errorLoad')`. Citation: `apps/web/src/app/[locale]/admin/(protected)/sales/page.tsx:45`. Reviewers: code-reviewer LOW-06, critic CRITIC-06.

- [ ] **P262-11 / C3-RPF-11** — Escalate webhook reject branches (tier / amount / payment_status) to `console.error`. Citation: `apps/web/src/app/api/stripe/webhook/route.ts:84-106`. Reviewer: critic CRITIC-04.

- [ ] **P262-12 / C3-RPF-12** — Source-contract tests for cycle 3 fixes:
  - `payment_status !== 'paid'` guard precedes INSERT (stripe-webhook-source.test.ts).
  - `amountTotalCents <= 0` (or positive-amount) guard precedes INSERT.
  - Download route imports `UPLOAD_DIR_ORIGINAL` from upload-paths (new test or extend serve-upload.test.ts).
  - `Content-Disposition` filename sanitizer present in download route.
  - `lstat` precedes the atomic claim in download route.
  - `customerEmail` lowercased before INSERT.

- [ ] **P262-13 / C3-RPF-13** — `download-tokens.ts` JSDoc qualifier "lowercase hex". Citation: `apps/web/src/lib/download-tokens.ts:8-15`. Reviewer: document-specialist LOW-06.

- [ ] **P262-14 / C3-RPF-D07 (in-cycle subset)** — Add a short retention warning to `apps/web/README.md` under "Manual download distribution" and to `apps/web/.env.local.example` near `LOG_PLAINTEXT_DOWNLOAD_TOKENS`. Reviewers: security-reviewer MED-02, document-specialist LOW-01.

## Quality gates after this cycle

- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run lint:api-auth` clean.
- `npm run lint:action-origin` clean.
- `npm test` all green (937 → 937+ as new tests land).
- `npm run build` clean.

## Deploy mode

DEPLOY_MODE=end-only. Do NOT run `npm run deploy` this cycle. Record `DEPLOY: end-only-deferred`.

## Commit policy

Per AGENTS.md + user-global rules:
- One commit per fine-grained item (or tightly-related group).
- All commits signed (`-S`).
- Gitmoji + Conventional Commits header.
- No `Co-Authored-By`. No `--no-verify`. No skip hooks.
- `git pull --rebase` before each `git push`.
