# Deferred Review Coverage — Cycle 1

**Created:** 2026-04-20
**Status:** DONE
**Purpose:** Ensure every finding from the cycle-1 review batch is either scheduled in Plan 158 or explicitly deferred with rationale.

## Scheduled in Plan 158
| Review IDs | Citation | Original severity / confidence | Scheduled in | Notes |
| --- | --- | --- | --- | --- |
| U1 | `apps/web/src/proxy.ts:4-9,29-53` | HIGH / High | Plan 158 C1-01 | Freshly re-verified with curl + local Playwright |
| U2 | `apps/web/src/proxy.ts:4-9,29-53` | MEDIUM / High | Plan 158 C1-01 | Browser review can only resume after routing fix |
| T6 | `apps/web/playwright.config.ts:7-46`, `apps/web/package.json:18` | MEDIUM / Medium | Plan 158 C1-02, C1-03 | Existing E2E surface is misleading because it targets production by default |
| AG2, AG3, AG4 | see `.context/reviews/_aggregate.md` | HIGH/HIGH/LOW | Plan 158 C1-02, C1-03, C1-04 | Aggregate-only actionable items |

## Deferred / Invalidated After Verification
| Review IDs | Citation | Original severity / confidence | Reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| C1, C2, C3, S1, CR1, V1, V2, V3, A1, A4, DS1, DS4, Trace 1 | `apps/web/src/lib/data.ts:84-159` | High/High to Medium/High (as reported) | Re-reading current source invalidated these findings: `adminSelectFields` exists, `publicSelectFields` is derived by omission, and the `Extract<...>` guard is in place. No implementation work is required for the current revision. | Re-open only if `data.ts` regresses so public/admin field sets stop being distinct. |
| C4, C6, CR2, A2 | `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/images.ts` | Medium/High to High/High | Cleanup/refactor request rather than a verified behavior bug in the current revision. The repo has already accepted pragmatic duplication in prior deferred carry-forward notes. | Re-open if a concrete rate-limit bug appears that is caused by the duplication. |
| C5, D6 | `apps/web/src/lib/process-image.ts:423-428` | Low/Low | Low-probability EXIF normalization edge case; not reproduced in current tests or runtime review. | Re-open if a real metadata sample proves legitimate `'undefined'`/`'null'` strings are lost incorrectly. |
| C7 | `apps/web/src/app/actions.ts` | Low/Low | Barrel coupling concern only; no verified functional defect or failing gate. | Re-open if a concrete cache/tree-shaking regression is observed. |
| C8 | `apps/web/src/app/actions/topics.ts` | Medium/Medium | Already handled by `ER_DUP_ENTRY` catch; extra pre-check is inefficiency, not a correctness failure in the current code. | Re-open if the extra query causes measurable contention or stale-user-visible behavior. |
| P1 | `apps/web/src/lib/data.ts:getImages` | High/High | Performance caution about an exported helper, but no verified hot-path regression from current usage surfaced in gates or runtime checks. | Re-open if profiling shows `getImages` on a real hot path. |
| P2 | `apps/web/src/lib/data.ts:40-67` | Medium/Medium | Batched view-count flush is already bounded and previously accepted as a pragmatic design; no current failure signal. | Re-open if pool exhaustion or DB contention is observed during flushes. |
| P3, P4 | `apps/web/src/lib/image-queue.ts` | Medium/Medium | Queue bootstrap/backpressure concerns were already captured in earlier deferred carry-forward notes; no new failure was reproduced this cycle. | Re-open if pending-image volume or memory usage becomes an observed problem. |
| P5 | `apps/web/src/lib/data.ts:613-653` | Low/Low | Reviewer itself classified the current two-step query as a tradeoff, not a bug. | Re-open if query latency becomes measurable on search. |
| P6 | `apps/web/src/app/[locale]/admin/db-actions.ts:37-76` | Medium/Medium | CSV export memory concern is valid only for very large exports; not reproduced and not gate-blocking in this cycle. | Re-open if export size/user feedback shows real pressure. |
| P7, P8 | `apps/web/src/lib/process-image.ts`, `apps/web/src/db/index.ts` | Low/Low | Optimized/low-risk observations, not actionable defects in the current revision. | Re-open on evidence of image-processing or tag-aggregation bottlenecks. |
| S2 | `apps/web/src/app/actions/*.ts` | Medium/High | Invalidated by official Next.js server-action CSRF protections: same-origin POST + Origin/Host comparison already apply. Source: Next.js Data Security docs and `serverActions.allowedOrigins` docs (retrieved 2026-04-20). | Re-open only if a specific custom route/action bypass is demonstrated. |
| S3 | `apps/web/src/lib/sql-restore-scan.ts:1-42` | Medium/High | Invalidated by current code: hex and binary literals are already masked in `stripSqlCommentsAndLiterals`. | Re-open if a new dump sample bypasses the current scanner. |
| S4 | `apps/web/src/app/[locale]/admin/db-actions.ts:224-312` | Medium/Medium | Accepted deployment/operational risk for an authenticated admin-only restore feature; not newly introduced in this cycle and no repo rule requires sandboxing MySQL restores. | Re-open if restore is expanded beyond trusted-admin use. |
| S5 | `apps/web/next.config.ts:50-85` | Low/High | Invalidated by current CSP headers in `next.config.ts`. | Re-open if CSP headers are removed/regressed. |
| S6 | `apps/web/src/lib/rate-limit.ts:44-73`; `README.md:114-119`; `apps/web/README.md:29-31`; `CLAUDE.md` security notes | Medium/High | Deployment-configuration concern already documented in repo guidance and now warned at runtime. Repo docs explicitly require `TRUST_PROXY=true` behind the provided reverse proxy. | Re-open if deployed environments ignore the documented setting and the warning proves insufficient. |
| S7 | `apps/web/src/app/api/admin/db/download/route.ts` | Low/Low | Reviewer labeled it a fragility risk only; no concrete failure reproduced. | Re-open if filename format changes and downloads break. |
| S8 | `apps/web/src/app/actions/auth.ts:135` | Low/Low | Audit-log username capture is acceptable for an admin-auth flow in this repo and not prohibited by repo policy. | Re-open if audit logs broaden beyond admin operators. |
| CR3, A3, DS3 | `apps/web/src/lib/storage/index.ts`, settings UI, CLAUDE.md storage note | Medium/Medium or Positive | Already explicitly documented as “not yet integrated”; no hidden task remains for this cycle. | Re-open when storage integration work is intentionally scheduled. |
| CR4 | various | Medium/Medium | High-level critique, not a discrete implementation task beyond items already captured. | Re-open if a concrete new inconsistency becomes actionable. |
| V4, V5, V7, Trace 2, Trace 4 | cited in respective review files | High/High | These are confirmed-safe or positive validations, not defects to implement. | Re-open only if future regressions invalidate the verified-safe behavior. |
| T1, T2, T3, T4 | `apps/web/src/app/actions/*.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/serve-upload.ts` | High/High | Broad coverage-gap observations rather than cycle-1 bugs. A dedicated test-expansion pass is larger than this cycle and not required to keep gates green. | Re-open in a dedicated test-improvement cycle or if a change touches these surfaces. |
| T5 | `apps/web/src/lib/data.ts:84-159` | High/High | Invalidated with the rest of the privacy-separation false positives. | Re-open only if the public/admin field split regresses. |
| Trace 3 | `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/db/schema.ts` | Low (usability) / Medium | Potential UX rough edge under rare concurrent delete/upload races, but FK protection preserves data integrity and no reproducible failure was observed this cycle. | Re-open if admins report this race in practice. |
| A5 | `apps/web/src/lib/image-queue.ts` | Low/Low | Known single-process architecture tradeoff for a single-container deployment; not a current defect. | Re-open if horizontal scaling becomes a requirement. |
| A6 | repo migration/docs surface | Medium/Medium | Documentation/process improvement, not a verified runtime bug in this cycle. | Re-open when deployment/migration docs are being revised. |
| D1 | `apps/web/src/lib/data.ts:332-406` | Medium/Medium | Invalidated by current code: the “next” branch for `NULL` capture dates now explicitly handles dated images via `sql\`${images.capture_date} IS NOT NULL\``. | Re-open only if navigation regressions are reproduced. |
| D2 | `apps/web/src/app/actions/images.ts:85-137, 274-296` | Low/Low | Hypothetical eviction/slow-upload race not reproduced; current tracker is bounded and previous cycles accepted similar tradeoffs. | Re-open if uploads show mis-accounting in practice. |
| D3 | `apps/web/src/lib/revalidation.ts` | Low/Low | Invalidated by current implementation: empty/falsy paths are skipped. | Re-open only if a caller demonstrates unwanted root revalidation. |
| D4 | `apps/web/src/app/actions/tags.ts:310-356` | Low/Low | Speculative deadlock risk without a reproduced case. | Re-open if MySQL deadlocks are observed in logs. |
| D5 | `apps/web/src/lib/process-image.ts:381-396` | Low/Low | Crash-leftover `.tmp` cleanup would be nice, but no evidence this is currently harming correctness or gates. | Re-open if temp-file leakage is observed in the upload dirs. |
| DS2 | `CLAUDE.md`, `apps/web/package.json` | Medium/Medium | Version wording is close enough (`16.2` vs `^16.2.3`) and not misleading for this cycle. | Re-open when major-version docs are updated. |
| DS5 | `CLAUDE.md` | Positive / High | Explicitly a documented permanent decision, not a fix item. | Re-open only if product policy changes. |
| DS6 | `apps/web/src/lib/process-image.ts` | Medium/Medium | JSDoc depth request is documentation polish, not a cycle-1 bug. | Re-open when this module is materially edited. |
| DS7 | `CLAUDE.md`, `apps/web/src/db/schema.ts` | Low/Low | Secondary-index omission in docs is informational and not breaking current work. | Re-open if schema docs are being refreshed. |

## Notes
- This deferred file intentionally preserves the original severity/confidence reported by the reviewers, even when later verification invalidated the finding.
- Where repo guidance already documents an operational prerequisite (for example `TRUST_PROXY=true` behind the provided reverse proxy), the deferred reason references that existing rule rather than contradicting it.

## Warning-level deferrals recorded this cycle
| Warning | Source | Reason deferred | Exit criterion |
| --- | --- | --- | --- |
| NFT tracing warning | `npm run build --workspace=apps/web` (`next.config.ts` import trace) | Next/Turbopack warns that an app-route import chain causes wide NFT tracing. This warning did not block build/test correctness and needs a broader packaging investigation than this cycle. | Re-open when deployment packaging or NFT size becomes a prioritized task. |
| `TRUST_PROXY` warning | `npm run build --workspace=apps/web`, `npm run test:e2e --workspace=apps/web` | Environment warning already documented in `README.md`, `apps/web/README.md`, `CLAUDE.md`, and `src/lib/rate-limit.ts`; local verification intentionally ran without proxy trust enabled. | Re-open if deployment environments still omit `TRUST_PROXY=true` behind the documented reverse proxy. |
| `next start` standalone warning | `npm run test:e2e --workspace=apps/web` webServer log | Local Playwright now uses a supported boot path that works, but Next still warns because `output: 'standalone'` is enabled while using `next start`. Removing `output: 'standalone'` would broaden scope into deployment behavior. | Re-open when deployment/runtime packaging is intentionally revisited. |
| `NO_COLOR` tooling warnings | local Playwright/build subprocess logs | Environment/tooling warning unrelated to repo source; fixing it would require changing shell environment policy rather than product code. | Re-open if CI or repo scripts adopt a stricter warning policy for shell environment variables. |
