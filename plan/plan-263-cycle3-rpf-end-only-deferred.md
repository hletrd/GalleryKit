# Plan 263 — Cycle 3 RPF (end-only) deferred review findings

Status: active-deferred

## Repo-policy basis for deferral

Read order: `CLAUDE.md`, `AGENTS.md`, `.context/**` plan/deferred history, user-global rules (signed-gitmoji-conventional commits, fine-grained, no `Co-Authored-By`, no `--no-verify`). `.cursorrules` and `CONTRIBUTING.md` and `docs/` policy files are absent.

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
| **C3-RPF-D01** — Refund action TOCTOU on `refunded` flag | Medium / Medium | `apps/web/src/app/actions/sales.ts:120-167` | Practical risk bounded by row-side `if (row.refunded)` guard + Stripe's own `charge_already_refunded` mapping. Cost is a wasted Stripe API call per concurrent click. | Re-open when first Stripe rate-limit pressure observed, or when `stripe_refund_id` schema migration (D09) lands. |
| **C3-RPF-D02** — Refund Stripe-vs-DB split-brain (Stripe succeeds, DB update fails) | Medium / High | `apps/web/src/app/actions/sales.ts:142-167` | Safe replay requires `stripe_refund_id` persistence in the schema. Schema change requires migration 0014 + UI updates. | Re-open when migration 0014 ships (any reason), or when first reconciliation incident observed. |
| **C3-RPF-D03** — Webhook event-type dispatcher is in-line | Medium / High | `apps/web/src/app/api/stripe/webhook/route.ts:57-164` | Refactor scope. Current single-event handler is correct. | Re-open when adding `checkout.session.async_payment_succeeded` or `charge.refunded` event handling. |
| **C3-RPF-D04** — Sales table not responsive on small screens | Medium / High | `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-222` | Refactor scope; admin /sales is desktop-primary. Cycle 2 added overflow-x-auto. | Re-open when first usage analytics show meaningful mobile admin sessions, or at next admin polish-pass. |
| **C3-RPF-D05** — Buy button lacks aria-label with photo title | Low / High | `apps/web/src/components/photo-viewer.tsx:450-494` | Photo-viewer received many a11y improvements in cycles 1 RPF; this is cosmetic. | Re-open at next a11y audit pass. |
| **C3-RPF-D06** — Customer email cell needs `break-all` styling | Low / High | `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:199` | Cosmetic; only affects very long emails. | Re-open at next product polish-pass. |
| **C3-RPF-D07** — `LOG_PLAINTEXT_DOWNLOAD_TOKENS` broader log-shipper redaction guidance (in-cycle subset is in P262-14) | Low / High | `apps/web/README.md`, `apps/web/.env.local.example` | The in-cycle subset adds a retention warning. The broader doc work (per-shipper rules, redaction patterns) is bigger. | Re-open when log-shipper guidance becomes a real operator question, or when phase-2 email pipeline ships. |
| **C3-RPF-D08** — `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` shape validation | Low / High | `apps/web/src/lib/stripe.ts` | Cosmetic safety net; garbage values fail fast at first Stripe call. | Re-open when first deployment misconfig surfaces. |
| **C3-RPF-D09** — `stripe_refund_id` persistence (carry-forward C2-RPF-D08) | Low / High | `apps/web/src/db/schema.ts:251-266`, `sales.ts:115-130` | Schema migration 0014; no current incident. | Re-open when first "did the refund land?" support ticket comes in, or when migration 0014 lands for any other reason. |
| **C3-RPF-D10** — Move `deriveLocaleFromReferer` out of `lib/license-tiers.ts` | Low / High | `apps/web/src/lib/license-tiers.ts:46-60` | Cosmetic refactor; helpers work as-is. | Re-open at next i18n-utility pass. |
| **C3-RPF-D11** — Carry-forward of cycle 2 deferred items D01, D03, D05, D06, D08, D10, D11, D12, D13, D15, D16, D17 | (varied) | See `plan/plan-261-cycle2-rpf-end-only-deferred.md` | Same rationale as cycle 2; not regressed in cycle 3. Cycle 3 closes D02 (delete `getTotalRevenueCents`) and partially D04 (lstat-before-claim aligned with C3-RPF-05). | Same exit criteria as cycle 2 (preserved). |

## Disposition completeness check

All cycle 3 RPF aggregate findings are accounted for:
- Scheduled in Plan 262: C3-RPF-01..13 (in-cycle subset of D07).
- Deferred here: D01, D02, D03, D04, D05, D06, D07 (broader doc), D08, D09, D10, D11.
- Cycles 1+2 RPF carry-forward: verified in code; nothing silently dropped.

Cycle 2 deferred items being closed in cycle 3:
- C2-RPF-D02 (`getTotalRevenueCents` is duplicate work) — closed by P262-06 (delete the action).
