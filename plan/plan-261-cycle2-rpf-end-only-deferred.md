# Plan 261 — Cycle 2 RPF (end-only) deferred review findings

Status: active-deferred

## Repo-policy basis for deferral

Read order followed before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/**` plan/deferred history, user-global rules (signed-gitmoji-conventional commits, fine-grained, no `Co-Authored-By`, no `--no-verify`). `.cursorrules` and `CONTRIBUTING.md` and `docs/` policy files are absent.

Repo rules preserved:
- Future implementation of any deferred item remains bound by `AGENTS.md:3-4` and the user-global commit rules (signed, gitmoji, conventional, fine-grained).
- Toolchain remains Node 24+/TypeScript 6/ESNext per `CLAUDE.md`.
- Single-writer/single-instance topology rule (`CLAUDE.md:160`, `README.md:146`) explicitly permits deferral of horizontal-scaling correctness risks.
- Permanently deferred items per `CLAUDE.md`: only 2FA/WebAuthn. Nothing below is permanently deferred.

Security, correctness, and data-loss findings are NOT deferred unless covered by an explicit repo rule. The deferred items below are either UX polish, low-probability edge cases bounded by other guards, or perf/architecture refactors with no current incident.

## Deferred items

| Finding | Original severity / confidence | Citation | Concrete reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| **C2-RPF-D01 — Memoize Intl.NumberFormat in photo-viewer Buy IIFE** | Low / Medium | `apps/web/src/components/photo-viewer.tsx:484-491` | Marginal perf only; no correctness issue. Cycle 1 RPF prioritized correctness (locale formatting). | Re-open when photo viewer profiling shows formatter cost > 1% of render time, or when a shared currency-format hook is introduced. |
| **C2-RPF-D02 — `getTotalRevenueCents` is duplicate work after row-side fix** | Low / High | `apps/web/src/app/actions/sales.ts:76-91`; `sales-client.tsx:71-80` | Tied to the C2-RPF-05 fix scheduled in Plan 260; once that lands the server-side fallback is provably unused, but removing the action requires a follow-up to confirm no callers. | Re-open in the cycle after Plan 260 lands when call-site analysis confirms the action is unused. |
| **C2-RPF-D03 — `entitlements` cascade-delete on image removal destroys audit trail** | Low / High | `apps/web/src/db/schema.ts:251-266` | Schema change requires migration 0014 + admin-action UI changes. Current shipped behavior matches the original feature spec and no real audit incident has occurred. | Re-open when first real refund-after-image-delete incident occurs, or when finance-grade retention becomes a product requirement, or when migration 0014 happens for any other reason. |
| **C2-RPF-D04 — Webhook orphan-image race causes 500 + Stripe retry storm** | Low / High | `apps/web/src/app/api/stripe/webhook/route.ts:96-119` | Low probability (admin must delete the image during the 1–2s checkout-to-webhook gap). When email pipeline ships, the auto-refund path will land naturally. | Re-open when first real orphan webhook event observed, or when email-pipeline phase ships. |
| **C2-RPF-D05 — Buy button does not show tier label** | Low / High | `apps/web/src/components/photo-viewer.tsx:476-493` | Requires translation strings + product decision on tier-visibility. | Re-open when product confirms tier-visibility policy, or when adding any new tier. |
| **C2-RPF-D06 — Download token TTL not surfaced in customer copy** | Low / High | `apps/web/messages/en.json:703`; `ko.json:677`; `webhook/route.ts:107` | Copy is tied to email pipeline phase (where actual delivery latency is set). | Re-open when email pipeline ships. |
| **C2-RPF-D07 — `Content-Disposition` filename safety on download route** | Low / High | `apps/web/src/app/api/download/[imageId]/route.ts:148` | Risk is bounded by upload-side filename sanitization. The canonical `photo-{id}{ext}` pattern is mostly safe; vulnerable only to admin-set filenames containing `"`. | Re-open when upload-side filename allowlist is added, or when the customer-visible filename surfaces a real issue. |
| **C2-RPF-D08 — Persist `stripe_refund_id` on refund** | Low / High | `apps/web/src/app/actions/sales.ts:115-130`; `apps/web/src/db/schema.ts:251-266` | Schema migration 0014 for a low-effort audit improvement; no current support ticket. | Re-open when first "did the refund land?" support ticket comes in, or when migration 0014 lands for any other reason. |
| **C2-RPF-D09 — Drizzle download UPDATE result-shape resilience** | Medium / Medium | `apps/web/src/app/api/download/[imageId]/route.ts:96-106` | Practical risk is bounded by line-70 `verifyTokenAgainstHash` guard and line-85 `downloadedAt !== null` guard. Both block re-use even if the affectedRows fallback misfires. Tightening to `Array.isArray + typeof` adds defense-in-depth but no current bug. | Re-open when drizzle MySQL driver shape changes again, or when the line-70/line-85 guards are restructured. |
| **C2-RPF-D10 — `expiresAt` TZ semantics roundtrip test** | Low / High | `apps/web/src/db/schema.ts:260`; `apps/web/src/app/api/stripe/webhook/route.ts:107` | Existing infra is UTC (Docker default). Test is the cleanest fix. | Re-open when DB connection TZ is changed, or when expiresAt drift is observed. |
| **C2-RPF-D11 — /admin/sales pagination + search** | Low / High | `apps/web/src/app/actions/sales.ts:35-52` | The 500-row cap is correct hardening. Pagination is a UX improvement, not a correctness fix. | Re-open when first gallery exceeds 500 sales, or when older-sale lookups become a real support need. |
| **C2-RPF-D12 — Empty-state polish for /admin/sales** | Informational / High | `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:88-90` | Pure polish. | Re-open at the next product polish-pass. |
| **C2-RPF-D13 — Cancel toast copy is muted** | Low / High | `apps/web/messages/en.json:704`; `ko.json:678` | Pure copy preference. | Re-open at next product copy review. |
| **C2-RPF-D14 — Full Stripe operator section in README + CLAUDE.md** | Low / High | `apps/web/README.md`; `CLAUDE.md` | Plan 260 P260-15 covers the in-cycle subset (env vars + manual-distribution). The remaining doc breadth (webhook URL registration, retry semantics, admin support runbook) is a larger doc task. | Re-open when first new-operator deployment surfaces a doc gap, or when email-pipeline phase ships and docs need to be updated anyway. |
| **C2-RPF-D15 — `lint:action-origin` regression test for `@action-origin-exempt` markers** | Low / Medium | `apps/web/scripts/check-action-origin.ts`; `apps/web/src/app/actions/sales.ts:30,75` | Tooling-coverage improvement; no current gate failure. The npm script gate already runs against the repo. | Re-open when action-origin scanner gains additional comment markers, or when first marker-related regression occurs. |
| **C2-RPF-D16 — Extract `formatCents` and `getStatus` from `sales-client.tsx` for unit tests** | Low / High | `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:36-45` | Refactor + test. Behavior is exercised by Plan 260 P260-04 and P260-05 fixes via the locale-aware path. | Re-open when adding a new sales-status state, or when status decision-tree changes. |
| **C2-RPF-D17 — `customer_email` not Stripe-prefilled on Checkout** | Medium / Medium | `apps/web/src/app/api/checkout/[imageId]/route.ts:139` | Workflow improvement (resend-token affordance) tied to email pipeline phase. Current customer-typed email path is acceptable while manual distribution is the primary flow. | Re-open when email pipeline ships, or when first customer-email-typo support ticket arrives. |

## Disposition completeness check

All cycle 2 RPF aggregate findings are accounted for:
- Scheduled in Plan 260: C2-RPF-01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, plus the in-cycle subset of D14 (env vars + manual-distribution paragraph).
- Deferred here: D01, D02, D03, D04, D05, D06, D07, D08, D09, D10, D11, D12, D13, D14 (broader doc), D15, D16, D17.

Cycle 1 RPF carry-forward (verified in `.context/reviews/_aggregate-cycle2-rpf-end-only.md` Verification section) is preserved as in-code fixes; nothing from cycle 1 silently dropped.
