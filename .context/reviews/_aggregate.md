# Cycle 7 Aggregate Review

**Date:** 2026-04-22
**Scope:** review-plan-fix cycle 7 (`deeper`, `ultradeep comprehensive`)

## Review fan-out summary

Completed specialist notes this cycle:
- `code-reviewer`
- `security-reviewer`
- `critic`
- `verifier`
- `test-engineer`

Manual fallback specialist notes were added for:
- `architect` (the spawned architect lane reported a read-only-policy completion with no file write)
- `debugger`
- `designer`
- `perf-reviewer`
- `tracer`
- `document-specialist`
- `dependency-expert`

The environment's child-agent lane cap prevented a single all-at-once fan-out across every specialty, so I combined completed agent output with a repo-wide manual fallback sweep and refreshed the missing per-role markdown files directly.

## Dedupe rules

- Only findings re-verified against the current working tree during cycle 7 are included below.
- Overlapping specialist notes were merged under the highest severity/confidence still supported by the code.
- Findings already fixed in this cycle are still listed here because they were new review output for cycle 7 and drove plans 185/186.

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C7-01 | HIGH | High | security-reviewer, debugger | `serveUploadFile()` trusted lexical containment and could be tricked through a symlinked parent directory inside `public/uploads`. | `apps/web/src/lib/serve-upload.ts:32-97` |
| C7-02 | MEDIUM | High | debugger, test-engineer | The admin backup download route masked unexpected filesystem failures as `404`, making operator-facing failures look like missing files. | `apps/web/src/app/api/admin/db/download/route.ts:17-51` |
| C7-03 | MEDIUM | High | verifier, debugger, tracer | Duplicate tag query params survived parsing and could zero out valid gallery results by inflating the `COUNT(DISTINCT ...)` HAVING clause. | `apps/web/src/lib/tag-slugs.ts:3-10`, `apps/web/src/lib/data.ts:277-289` |
| C7-04 | MEDIUM | High | code-reviewer | The SQL restore safety scan only used forward overlap, leaving a chunk-boundary bypass path for dangerous statements with long padding between tokens. | `apps/web/src/app/[locale]/admin/db-actions.ts:323-340`, `apps/web/src/lib/sql-restore-scan.ts:1-34` |
| C7-05 | MEDIUM | High | security-reviewer, document-specialist | nginx accepted bodies far larger than the app-level upload/restore limits, leaving the reverse proxy exposed to oversized request buffering before application validation ran. | `apps/web/nginx/default.conf:13-18,47-60`, `apps/web/src/lib/upload-limits.ts:1-22`, `apps/web/src/lib/db-restore.ts:1-17` |
| C7-06 | MEDIUM | High | architect, critic | Share-link copy paths still used `window.location.origin` instead of the canonical configured public origin. | `apps/web/src/components/photo-viewer.tsx:253-266`, `apps/web/src/components/image-manager.tsx:158-167`, `apps/web/src/lib/data.ts:783-790` |
| C7-07 | MEDIUM | High | code-reviewer, designer, perf-reviewer | Tiny search/admin preview surfaces still requested the full base JPEG instead of a small generated derivative. | `apps/web/src/components/search.tsx:208-215`, `apps/web/src/components/image-manager.tsx:342-349`, `apps/web/src/lib/process-image.ts:393-406` |
| C7-08 | MEDIUM | High | verifier | `batchUpdateImageTags()` silently dropped malformed tag names instead of surfacing a partial-failure signal. | `apps/web/src/app/actions/tags.ts:347-400` |
| C7-09 | MEDIUM | Medium | verifier | Settings/SEO forms can keep stale local state after the server sanitizes and persists canonical values. | `apps/web/src/app/actions/settings.ts:51-78`, `apps/web/src/app/actions/seo.ts:64-103`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:33-56`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39-53` |
| C7-10 | LOW | High | dependency-expert | The dev-tooling dependency tree still carries the `drizzle-kit` -> `esbuild` advisory chain reported by `npm audit`. | `apps/web/package.json:56-70`, `package-lock.json` |

## Manual-validation / operational risks

| ID | Severity | Confidence | Source | Why it stays a risk |
|---|---|---|---|---|
| R7-01 | LOW | High | security-reviewer | `/api/health` remains publicly probeable through the reverse proxy. Tightening it safely depends on the operator's external monitoring contract and was not changed in this bounded cycle. |
| R7-02 | MEDIUM | Medium | security-reviewer, architect | Restore maintenance is still process-local beyond the DB advisory lock, so true multi-instance restore fencing remains a scale-out concern. |
| R7-03 | LOW-MEDIUM | High | test-engineer | Broader mutation/share/queue/settings/deploy script coverage remains thinner than the core helper library coverage. |

## Plan routing

- **Implemented in Plan 185:** C7-01, C7-02, C7-03, C7-04, C7-05 plus fresh regression coverage for the touched contracts.
- **Deferred in Plan 186:** C7-06 through C7-10 and manual-validation risks R7-01 through R7-03.

## Cross-agent agreement

- C7-03 was independently rediscovered by verifier, debugger, and tracer.
- C7-05 was corroborated by both the security and documentation sweeps.
- C7-07 appeared as both a UX and performance concern, increasing confidence that it is user-visible.

## Aggregate conclusion

Highest-value cycle-7 fixes were the upload-serving/download boundary hardening, tag-filter normalization, restore scan carry-over hardening, and aligning nginx body caps with the real app limits. Remaining issues are real but broader product/ops/test-surface follow-up rather than safe bounded fixes for this pass.
