# Aggregate — Cycle 1 RPF v3 (HEAD: 67655cc)

## Run context

- **HEAD:** `67655cc test(consolidation): lock humanizeTagLabel and hreflang single-source-of-truth`
- **Cycle:** 1/100 of the current review-plan-fix loop
- **User-injected designer review:** `.context/reviews/designer-uiux-deep-v2.md`
- **Reviewers run inline (Task tool not registered in this catalog):**
  code-reviewer, perf-reviewer, security-reviewer, critic, verifier,
  test-engineer, tracer, architect, debugger, document-specialist, designer
- **Reviewer files:** `<lens>-cycle1-rpf3.md` for each lens

## Aggregate verdict

**Confirmed: 6 NEW + 5 partial designer-v2 findings.**

| ID | Severity | Confidence | Reviewer agreement | Files |
|---|---|---|---|---|
| **NF-3** (= F-18 partial) — `tag_names` null in correlated subquery | **High** | High | 6/11 (code-reviewer, critic, debugger, tracer, architect, verifier) | `apps/web/src/lib/data.ts:324, 374, 428` |
| **NF-2a** — LightboxTrigger 32 px | **High** | High | 4/11 (code-reviewer, critic, verifier, designer) | `apps/web/src/components/lightbox.tsx:41` |
| **NF-2b** — Desktop Info toggle 32 px | **High** | Medium-High | 3/11 | `apps/web/src/components/photo-viewer.tsx:314-328` |
| **NF-1** — Admin submit + password toggle 36 px | Medium | High | 4/11 | `apps/web/src/app/[locale]/admin/login-form.tsx:84,102` |
| **NF-4** — Nav topic links 32 px | Medium | High | 4/11 | `apps/web/src/components/nav-client.tsx:119` |
| **NF-5** — Load More 36 px | Low | High | 4/11 | `apps/web/src/components/load-more.tsx:102` |
| **NF-6** — Site title 28 px | Low | High | 3/11 | `apps/web/src/components/nav-client.tsx:78` |
| **F-10/F-23 partial** — Blur placeholder fetched but not wired | Low | High | 3/11 | `apps/web/src/components/photo-viewer.tsx:346` |
| **F-19 partial** — Mobile nav scroll affordance still weak | Low | Medium | 1/11 | `nav-client.tsx:103-109` |

## Cross-cutting recommendations from reviewers

- **TE-1 / A-2:** Add fixture-style touch-target test
  (`apps/web/src/__tests__/touch-target-audit.test.ts`) so future
  regressions fail at lint time. Modeled after
  `tag-label-consolidation.test.ts`.
- **TE-2 / A-1:** Add unit test that `getImagesLite` returns non-null
  `tag_names` when image has tags. Lock the data-layer contract that
  F-18 depends on.
- **DS-1:** After NF-3 fix lands, update the docblock at
  `apps/web/src/lib/data.ts:309-313` so it reflects the LEFT-JOIN
  rationale.

## Cross-reviewer agreement on fix path for NF-3

- **Path 1 (LEFT JOIN + GROUP BY):** preferred by code-reviewer, tracer,
  architect, debugger. Matches the working `getImages` at
  `data.ts:398-410`. Pros: single proven code path, lowest risk. Cons:
  re-introduces GROUP BY scan, but acceptable on personal-gallery scale.
- **Path 2 (Drizzle column refs in correlated subquery):** secondary
  option from tracer.md; lower perf cost but higher implementation risk.
- **Path 3 (subquery wrapper via Drizzle `subquery().as()`):** explicit
  but more complex.

**Cycle 1 will take Path 1.**

## Quality-gate baseline (pre-fix at HEAD `67655cc`)

Per cycle 3 loop aggregate, the baseline gates were green. PROMPT 3 must
re-confirm after each commit.

## Agent failures

None — all reviewer lenses produced files. The Task spawn-agent tool was
not in the deferred-tool catalog (`ToolSearch select:Task` returned no
matches), so all reviewer lenses ran inline with file evidence
cross-checked against the user-injected designer-v2 review's live DOM
measurements.
