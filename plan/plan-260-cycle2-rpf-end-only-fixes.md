# Plan 260 — Cycle 2 RPF (end-only) review fixes

Status: in-progress (PROMPT 3)

## Source reviews

- Per-agent reports under `.context/reviews/{code-reviewer,security-reviewer,perf-reviewer,critic,architect,test-engineer,verifier,tracer,debugger,document-specialist,designer}-cycle2-rpf-end-only.md`.
- Aggregate: `.context/reviews/_aggregate-cycle2-rpf-end-only.md` and `.context/reviews/_aggregate.md` (mirror).

## Repo rules read before planning

Read order followed: `CLAUDE.md`, `AGENTS.md`, `.context/**` plan/deferred history, `.cursorrules` (absent), `CONTRIBUTING.md` (absent), and `docs/` policy files (absent). Repo rules applied:

- `AGENTS.md:3-4`: always commit and push; gitmoji.
- User-global rule: GPG-sign every commit (`git commit -S`); fine-grained commits (one per fix).
- `CLAUDE.md:160` / `README.md:146`: shipped topology is single web instance / single writer; in-memory rate-limit + file-system token state are acceptable for current scope.
- `CLAUDE.md`: Node.js 24+, Tailwind/ESNext target, semantic commits with conventional + gitmoji.

## Scheduled implementation items (this cycle)

Each line below maps to one or more aggregate findings. All are scheduled (none silently dropped). Items marked Defer are captured in `plan/plan-261-cycle2-rpf-end-only-deferred.md`.

### Workflow / customer experience

- [x] **P260-01 / C2-RPF-01** — Surface plaintext download token at webhook for ops retrieval. Add a `console.info` line gated behind `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` env flag. Document the env in `apps/web/.env.local.example` and in a new "Stripe paid downloads" section in `apps/web/README.md`. Citation: `apps/web/src/app/api/stripe/webhook/route.ts:105,132`.
- [x] **P260-02 / C2-RPF-02** — Refund button: confirmation dialog + destructive variant. Wrap `<Button>` in `sales-client.tsx` with `<AlertDialog>` (existing UI primitive in `apps/web/src/components/ui/alert-dialog.tsx`). Confirmation copy includes customer email, image title, amount in visitor's locale. Citation: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:131-142`.

### Data hygiene

- [x] **P260-03 / C2-RPF-03** — Validate `customerEmail` shape at webhook ingest before insert. Use `^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$` regex (RFC-conformant for the common case; rejects unicode-direction characters). On failure, log warn + return 200 (Stripe stops retrying). Citation: `apps/web/src/app/api/stripe/webhook/route.ts:67-83`.

### Admin UI

- [x] **P260-04 / C2-RPF-04** — `sales-client.tsx`: locale-aware currency formatting via `Intl.NumberFormat`. Use `useLocale()` from next-intl. Mirror photo-viewer pattern. Citation: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:36-38,80,120`.
- [x] **P260-05 / C2-RPF-05** — Drop the `nonRefundedRevenue || totalRevenueCents` fallback. Show `nonRefundedRevenue` directly. Update copy/tests. Citation: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:71-80`.
- [x] **P260-06 / C2-RPF-09** — Status column: add lucide icon next to status text for color-blind users (WCAG 1.4.1). Citation: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:120-130`.
- [x] **P260-07 / C2-RPF-13** — Map known Stripe refund-error codes to localized strings; log full error server-side; return localized message to client. Citation: `apps/web/src/app/actions/sales.ts:135` and `sales-client.tsx:57`.

### Public viewer UI

- [x] **P260-08 / C2-RPF-07** — Wrap empty CardFooter on paid images. The `<CardFooter>` should not render when there is no Download button. Citation: `apps/web/src/components/photo-viewer.tsx:830-850`.
- [x] **P260-09 / C2-RPF-14** — Append `…` when truncating `image.title` for Stripe `product_data.name`. Citation: `apps/web/src/app/api/checkout/[imageId]/route.ts:117`.

### Library hygiene

- [x] **P260-10 / C2-RPF-08** — Import `LOCALES` from `lib/constants.ts` in `lib/license-tiers.ts`; remove the local `SUPPORTED_LOCALES` literal. Update the misleading comment that pointed to `i18n/config.ts`. Citation: `apps/web/src/lib/license-tiers.ts:38-58`.
- [x] **P260-11 / C2-RPF-06 + C2-RPF-10** — `verifyTokenAgainstHash`: validate storedHash matches `^[0-9a-f]{64}$` before `Buffer.from`; warn on mismatch. Citation: `apps/web/src/lib/download-tokens.ts:41-53`.

### Tests

- [x] **P260-12 / C2-RPF-11** — Add vitest suite for `deriveLocaleFromReferer` covering null/malformed referer, locale match, locale miss, case-insensitivity. Citation: `apps/web/src/lib/license-tiers.ts:44-58`.
- [x] **P260-13 / C2-RPF-11b** — Add vitest test for webhook tier allowlist rejection (event with `metadata.tier='admin'` returns 200 without DB insert). Citation: `apps/web/src/app/api/stripe/webhook/route.ts:90-94`.
- [x] **P260-14 / C2-RPF-12** — Add vitest test asserting refunded entitlement cannot be downloaded with the same token. Citation: `apps/web/src/__tests__/stripe-download-tokens.test.ts` + new test or extension.

### Docs

- [x] **P260-15 / C2-RPF-D14 (in-cycle subset)** — Add a short "Paid downloads (Stripe)" section to `apps/web/README.md` listing required env vars and the manual-distribution operational path until phase 2 ships. Mirror `LOG_PLAINTEXT_DOWNLOAD_TOKENS` from P260-01. Citations: `apps/web/README.md`, `apps/web/.env.local.example`.

## Required gates (PROMPT 3)

After implementation, the orchestrator runs all gates:
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run lint:api-auth`
- [x] `npm run lint:action-origin`
- [x] `npm test`
- [ ] `npm run test:e2e` (orchestrator-level)
- [ ] `npm run build` (orchestrator-level)

Errors are blocking; warnings best-effort.

## Progress log

- [x] PROMPT 2 plan authored.
- [x] PROMPT 3 implementation: P260-01 through P260-15.
- [x] Gates green after implementation: lint, typecheck, lint:api-auth, lint:action-origin, vitest.
- [x] Signed gitmoji commits pushed for each fine-grained change.

## Disposition completeness check

Per the cycle 2 RPF aggregate:
- Scheduled here: C2-RPF-01..14 (with C2-RPF-D14 partially in-cycle).
- Deferred in plan-261: C2-RPF-D01..D14 (with exit criteria).
- All cycle 1 carry-forward verified earlier this cycle.
