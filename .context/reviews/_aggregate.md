# Cycle 8 Aggregate Review

**Date:** 2026-04-22
**Scope:** review-plan-fix cycle 8 (`deeper`, `ultradeep comprehensive`)

## Review fan-out summary

Completed specialist notes this cycle:
- `code-reviewer`
- `security-reviewer`
- `test-engineer`
- `critic` (manual file refresh from completed read-only lane output)
- `architect` (manual fallback)
- `debugger` (manual fallback)
- `verifier` (manual fallback after one context-window failure + stalled retry)
- `designer` (manual fallback)

Unavailable / not registered in this session:
- `perf-reviewer`
- `tracer`
- `document-specialist`

## Agent failures / execution notes

- The first `verifier` lane failed with a context-window exhaustion error before writing its file.
- A retry `verifier` lane and follow-on `architect`, `debugger`, and `designer` lanes stalled after the initial repo scan; I shut them down and refreshed their review files manually so PROMPT 1 still has per-role provenance.
- The `critic` lane completed the review but could not write `critic.md` because that role was read-only in this session; the file was updated manually from the agent's returned findings.
- The `test-engineer` lane also ran extra verification and pushed one review-artifact commit (`fe84db5`). That commit is part of this cycle's commit count.

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C8-01 | MEDIUM | High | code-reviewer, debugger | `createGroupShareLink()` can silently succeed with a partial or empty image set if selected images disappear between pre-validation and the transactional insert. | `apps/web/src/app/actions/sharing.ts:200-245` |
| C8-02 | MEDIUM | High | code-reviewer, architect, verifier | Canonical topic redirects drop active tag filters when alias slugs are normalized to the canonical slug. | `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:87-95` |
| C8-03 | MEDIUM | High | critic, debugger | The search dialog has a stale-request race: clearing the query does not invalidate in-flight requests, so old results can reappear under an empty input. | `apps/web/src/components/search.tsx:35-57` |
| C8-04 | MEDIUM | High | critic, designer | Tiny search/admin preview surfaces still request the largest base JPEG derivative instead of a thumbnail-sized asset. | `apps/web/src/components/search.tsx:208-215`, `apps/web/src/components/image-manager.tsx:342-349`, `apps/web/src/lib/process-image.ts:393-414` |
| C8-05 | MEDIUM | High | critic, verifier, designer | Successful tag mutations do not immediately reconcile the current admin table with the canonical server state, so the UI can stay stale after success. | `apps/web/src/components/image-manager.tsx:183-200`, `apps/web/src/components/image-manager.tsx:371-399`, `apps/web/src/app/actions/tags.ts:347-400` |
| C8-06 | LOW | High | critic, debugger | Backup downloads use a filename derived from the URL instead of the server-returned filename, producing confusing download names. | `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:36-49`, `apps/web/src/app/[locale]/admin/db-actions.ts:218-219` |
| C8-07 | MEDIUM | High | architect, designer | Copied share links still use the operator's current browser origin instead of the configured canonical public origin. | `apps/web/src/components/photo-viewer.tsx:253-266`, `apps/web/src/components/image-manager.tsx:158-167`, `apps/web/src/lib/data.ts:783-790` |
| C8-08 | MEDIUM | High | test-engineer, verifier | `npm run test:e2e` still depends on pre-seeded fixture data even though the default local runner does not seed that state. | `apps/web/playwright.config.ts:27-58`, `apps/web/e2e/public.spec.ts:60-77`, `apps/web/e2e/admin.spec.ts:46-54`, `apps/web/scripts/seed-e2e.ts:22-28,183-186` |

## Deferred / broader follow-up items

| ID | Severity | Confidence | Source | Why deferred this cycle |
|---|---|---|---|---|
| D8-01 | MEDIUM | High | security-reviewer | Production CSP still permits `unsafe-inline`; fixing it safely requires a broader nonce/hash rollout across Next.js rendering and third-party scripts. |
| D8-02 | LOW | High | security-reviewer | `/api/health` remains publicly probeable; tightening it depends on the live monitoring contract. |
| D8-03 | MEDIUM | High | security-reviewer | Legacy short share keys are still accepted for backward compatibility; removing them safely needs a migration/rotation strategy. |
| D8-04 | MEDIUM | High | code-reviewer | Offset-based infinite-scroll pagination remains unstable under concurrent uploads/deletes; a proper fix requires cursor-pagination across route/action/client layers. |
| D8-05 | LOW | Medium | code-reviewer | Public search still likely ignores topic labels/aliases; the intended search semantics need product confirmation before widening the query model. |
| D8-06 | MEDIUM | High | critic | Failed background processing still lacks durable recovery metadata and admin retry tooling; this is larger than a bounded cycle-8 fix. |
| D8-07 | MEDIUM | High | security-reviewer, critic | Restore maintenance and some rate-limit controls still assume a single-process deployment topology. |
| D8-08 | MEDIUM | High | test-engineer | The repo still lacks an in-repo CI workflow that enforces lint/tests/typecheck/api-auth guard on pushes and PRs. |
| D8-09 | LOW | High | test-engineer | The visual Playwright specs still capture screenshots without assertions; converting them to stable snapshot tests needs baseline strategy work. |
| D8-10 | MEDIUM | High | security-reviewer | The `drizzle-kit` → `esbuild` advisory chain remains in the dev dependency tree and should be addressed in a dependency maintenance cycle. |

## Plan routing

- **Implement in Plan 187:** C8-01 through C8-08.
- **Defer in Plan 188:** D8-01 through D8-10, with preserved severity/confidence and explicit reopen criteria.

## Cross-agent agreement

- C8-02 was independently surfaced by code-reviewer, architect, and verifier.
- C8-04 was independently surfaced by critic and designer, increasing confidence that it is user-visible and performance-relevant.
- C8-05 was corroborated by critic, verifier, and designer, so the stale-state problem is both correctness and UX visible.
- C8-08 was independently surfaced by test-engineer and verifier.

## Aggregate conclusion

The highest-value bounded cycle-8 fixes are the share/action correctness issues (partial group shares, canonical-topic redirect loss, share URL origin), the stale search/admin UI behaviors, and making the default E2E runner self-contained. Larger architecture/ops follow-ups remain real but are better tracked as explicit deferred work than mixed into this cycle's safe hardening pass.
