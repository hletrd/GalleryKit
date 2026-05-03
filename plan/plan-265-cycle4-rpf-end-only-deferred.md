# Plan 265 — Cycle 4 RPF (end-only) deferred review findings

Status: active-deferred

## Repo-policy basis for deferral

Read order: `CLAUDE.md`, `AGENTS.md`, `.context/**` plan/deferred history, user-global rules (signed-gitmoji-conventional commits, fine-grained, no `Co-Authored-By`, no `--no-verify`).

Repo rules preserved:
- Future implementation of any deferred item remains bound by AGENTS.md commit rules.
- Single-writer/single-instance topology rule (CLAUDE.md, README.md) explicitly permits deferral of horizontal-scaling correctness risks.
- Permanently deferred items per CLAUDE.md: only 2FA/WebAuthn. Nothing below is permanently deferred.

Security, correctness, and data-loss findings are NOT deferred unless covered by an explicit repo rule. The deferred items below are either:
- UX polish, OR
- Bounded-risk hardening (other guards already in place), OR
- Scope-bounded refactors requiring schema migrations or larger architecture work.

## Deferred items

| Finding | Severity / Confidence | Citation | Concrete reason for deferral | Exit criterion |
|---|---|---|---|---|
| **C4-RPF-D01** — Sales table needs `expiresAt` column for support-triage UX | Low / Medium | `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-235` | UX scope. Status badge already encodes expired state. Cosmetic addition. | Re-open at next admin polish pass, or first support ticket about "I paid yesterday and never got my email." |
| **C4-RPF-D02** — `verifyTokenAgainstHash` Buffer.from try/catch is unreachable in practice | Low / Medium | `apps/web/src/lib/download-tokens.ts:62-70` | Dead-code hardening; STORED_HASH_SHAPE regex makes catch unreachable. Catch was added in cycle 2 P260-11 as defense-in-depth; removing risks regressing if STORED_HASH_SHAPE is dropped in a future refactor. | Re-open at next dead-error-path code-quality sweep. |
| **C4-RPF-D03** — `image.title` Stripe truncation may slice mid-codepoint | Low / Medium | `apps/web/src/app/api/checkout/[imageId]/route.ts:120-122` | Cosmetic; Stripe display normalizes; rare in practice (titles up to 199 chars with surrogate pair at exact boundary). | Re-open at next i18n / EXIF-title polish pass. |
| **C4-RPF-D04** — Email Unicode NFC normalization | Low / High | `apps/web/src/app/api/stripe/webhook/route.ts:90` | Rare; Stripe normalizes outbound; would require `.normalize('NFC')` after `.toLowerCase()`. | Re-open when first dedup miss observed in production. |
| **C4-RPF-D05** — Webhook race comment overstates ON DUPLICATE necessity | Informational / Medium | `apps/web/src/app/api/stripe/webhook/route.ts:200-203` | Doc-only; behavior is correct (Stripe serial-delivery makes the race practically zero). | Re-open at next webhook docs touch. |
| **C4-RPF-D06** — Download route stream-error after claim is non-recoverable | Low / High | `apps/web/src/app/api/download/[imageId]/route.ts:192-205` | Residual race window is microseconds (lstat → createReadStream); requires DB transaction to unwind. | Re-open when first observed incident. |
| **C4-RPF-D07** — Webhook FK violation when image deleted between checkout and delivery | Low / High | `apps/web/src/app/api/stripe/webhook/route.ts:198-217` | Bounded by admin discipline; admin UI doesn't surface in-flight checkouts; refund flow handles customer recovery via Stripe receipt. | Re-open when admin UI starts surfacing pending entitlements, or first observed incident. |
| **C4-RPF-D08** — Sales page LIMIT 500 will benefit from pagination as data grows | Low / Medium | `apps/web/src/app/actions/sales.ts:32-52` | Admin-only; not on hot path; D04 mobile responsiveness joins this. | Re-open when /admin/sales has >500 entitlements OR when D04 (mobile responsive sales) lands. |
| **C4-RPF-D09** — Carry-forward of cycle 1+2+3 deferred items | (varied) | See `plan/plan-263-cycle3-rpf-end-only-deferred.md` and earlier cycle deferred plans | Same rationale as cycles 1-3; not regressed in cycle 4. Cycle 4 closes none of cycle 3's deferred set. | Same exit criteria as prior cycles (preserved). |

## Disposition completeness check

All cycle 4 RPF aggregate findings are accounted for:
- Scheduled in Plan 264: C4-RPF-01..11 (11 in-cycle items).
- Deferred here: D01 through D09.
- Cycles 1+2+3 RPF carry-forward: verified in code (verifier-cycle4-rpf-end-only.md); nothing silently dropped.

## Deferred-fix policy compliance

- Every cycle 4 finding is either scheduled (plan-264) or deferred here with file+line citation, original severity/confidence (no downgrade), reason, and exit criterion.
- Repo rules (CLAUDE.md, AGENTS.md, .context/**) override defaults — verified read-order applied.
- No security/correctness/data-loss finding is being deferred without explicit rationale: all deferred items are bounded-risk hardening, UX polish, or schema-migration-bound refactors. None are HIGH or MEDIUM severity.
- Only existing findings are deferred; no new refactors are deferred.

## Done when

- This plan moves to plan/done/ once Plan 264 lands AND every D-item exit criterion event is tracked here.
- Until exit criteria fire, this plan stays active-deferred.
