# Cycle 9 Aggregate Review

**Date:** 2026-04-22
**Scope:** review-plan-fix cycle 9 (`deeper`, `ultradeep comprehensive`, `find yourself and make sure to not ask again`)

## Review fan-out summary

Completed specialist notes this cycle:
- `code-reviewer`
- `security-reviewer`
- `critic`
- `test-engineer`
- `document-specialist`
- manual fallback refreshes for `verifier`, `debugger`, `dependency-expert`, `architect`, and `designer`

Unavailable / not registered in this session:
- `perf-reviewer`
- `tracer`

## Agent failures / execution notes

- The `verifier`, `dependency-expert`, and `debugger` lanes hit context-window failures before they could finish cleanly.
- The `architect` and `designer` lanes stalled after initial scanning; I shut them down and refreshed their review files manually so PROMPT 1 still has per-role provenance.
- I performed an extra repo-wide manual sweep after the fan-out to honor the user’s `ultradeep comprehensive` request and to validate that no findings were silently dropped.

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C9-01 | MEDIUM | High | verifier, debugger, designer, manual sweep | Share-link copy flows can report success even when clipboard writes fail, and the helper has no legacy fallback path. | `apps/web/src/lib/clipboard.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/image-manager.tsx` |
| C9-02 | LOW | High | debugger, code-reviewer, manual sweep | Duplicate-entry handling in share/user-creation flows still depends on brittle error-message substrings instead of code-based checks. | `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/validation.ts` |
| C9-03 | MEDIUM | Medium | verifier, architect, dependency-expert, designer, manual sweep | Public search still ignores canonical topic labels/aliases and renders slug-derived topic text instead of the real topic label. | `apps/web/src/lib/data.ts`, `apps/web/src/components/search.tsx`, `apps/web/scripts/seed-e2e.ts`, `apps/web/e2e/public.spec.ts` |
| C9-04 | LOW | High | document-specialist, architect | Storage abstraction comments still overstate a switchable production backend even though live upload/serving paths remain filesystem-only. | `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/types.ts` |

## Deferred / broader follow-up items

| ID | Severity | Confidence | Source | Why deferred this cycle |
|---|---|---|---|---|
| D9-01 | MEDIUM | High | security-reviewer | Production CSP still permits `unsafe-inline`; fixing it safely still requires a broader nonce/hash rollout. |
| D9-02 | LOW | High | security-reviewer | `/api/health` still exposes DB liveness and depends on the live monitoring contract. |
| D9-03 | MEDIUM | High | security-reviewer | Legacy short share keys still exist for backward compatibility and need a migration plan before removal. |
| D9-04 | MEDIUM | High | architect, security-reviewer | Restore-maintenance and rate-limit coordination still assume a single-process deployment topology. |
| D9-05 | MEDIUM | High | test-engineer | The repo still lacks in-repo CI enforcement for lint/tests/build/auth-guard checks. |
| D9-06 | LOW | High | test-engineer | Visual Playwright capture still lacks stable assertion baselines. |

## Plan routing

- **Implement in Plan 189:** C9-01 through C9-04.
- **Defer in Plan 190:** D9-01 through D9-06, with preserved severity/confidence and explicit reopen criteria.

## Cross-agent agreement

- C9-01 was independently surfaced across verifier/debugger/designer angles, increasing confidence that it is both a correctness and UX bug.
- C9-03 was corroborated across verifier/architect/dependency/designer angles, so the search mismatch is both a data-contract and user-visible issue.
- C9-04 was independently reinforced by document-specialist and architect review.

## Aggregate conclusion

The highest-value bounded cycle-9 work is to make share-copy feedback truthful, normalize duplicate-entry handling onto robust MySQL codes, align search with the topic names users actually see, and narrow the storage comments so they match the current product reality. Larger security/ops/test follow-ups remain real, but they are better carried forward explicitly than mixed into this safe per-cycle hardening pass.
