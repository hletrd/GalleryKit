# Aggregate — Cycle 2/100 RPF loop (HEAD `8c4069c`, 2026-04-25)

## Run context

- **HEAD:** `8c4069c test(a11y): codify 44px touch-target floor as fixture audit`
- **Cycle:** 2/100 of the current review-plan-fix loop
- **Reviewers run inline (Task spawn-agent unavailable in this catalog):**
  code-reviewer, perf-reviewer, security-reviewer, critic, verifier,
  test-engineer, tracer, architect, debugger, document-specialist, designer
- **Reviewer files:** `<lens>.md` (overwriting prior cycle's content; cycle-1 versions remain in git history).
- **Aggregate file:** this file.

## Aggregate verdict

**Confirmed: 7 NEW MEDIUM, 4 NEW LOW.** Five cross-agent agreement
entries below have HIGH confidence.

### MEDIUM (7 findings)

| ID | Severity | Confidence | Reviewer agreement | Files | Summary |
|---|---|---|---|---|---|
| **AGG2-M01 = SR2-MED-01** | Medium | High | 3/11 (security, code-reviewer, critic) | `apps/web/src/components/photo-viewer.tsx:350-355` | Blur preview injects `image.blur_data_url` into inline CSS `url()` without `data:image/` prefix validation. No XSS today (single producer = Sharp), but no defense-in-depth. |
| **AGG2-M02 = CR2-MED-01 / TE2-MED-02 / DSGN2-MED-01** | Medium | High | 4/11 (code-reviewer, test-engineer, designer, critic) | `apps/web/src/__tests__/touch-target-audit.test.ts:36-84, 147-167` | Touch-target audit EXEMPTIONS list silently bypasses interactive admin surfaces with no companion guard. New violations in exempt files pass. |
| **AGG2-M03 = CR2-MED-02 / TE2-MED-03** | Medium | High | 3/11 (code-reviewer, test-engineer, critic) | `apps/web/src/__tests__/touch-target-audit.test.ts:90-103` | Touch-target audit FORBIDDEN regex misses HTML `<button>`, shadcn `size="icon"`, `cn()` composites, and Tailwind responsive variants. |
| **AGG2-M04 = TE2-MED-01** | Medium | High | 2/11 (test-engineer, critic) | `apps/web/src/__tests__/data-tag-names-sql.test.ts` | `getImagesLite*` runtime `tag_names` non-null assertion missing. Fixture-style test locks SQL shape, not runtime behavior. |
| **AGG2-M05 = PR2-MED-01 / DS2-MED-02** | Medium | High | 2/11 (perf, document-specialist, critic) | `apps/web/src/lib/data.ts:309-323` | LEFT JOIN + GROUP BY perf budget undocumented; CLAUDE.md doesn't reference the SQL shape. |
| **AGG2-M06 = A2-MED-01** | Medium | High | 1/11 (architect; cross-confirmed by perf) | `apps/web/src/lib/data.ts:330, 383, 440` | `tag_names` aggregation triple-duplicated across `getImagesLite`, `getImagesLitePage`, `getAdminImagesLite`. Drift risk. |
| **AGG2-M07 = DS2-MED-01** | Medium | High | 1/11 (document-specialist) | `CLAUDE.md` Lint Gates section | Touch-target audit not documented in CLAUDE.md alongside `lint:api-auth` / `lint:action-origin`. |
| **AGG2-M08 = DSGN2-MED-02** | Medium | Medium | 1/11 (designer) | `apps/web/src/components/photo-viewer.tsx:348-380` | Blur "flash" on rapid navigation: outer container's blur swaps instantly while inner motion.div fades over 200 ms. |

### LOW (4 findings)

| ID | Severity | Confidence | Reviewer | Summary |
|---|---|---|---|---|
| AGG2-L01 = TE2-LOW-01 / CR2-LOW-03/-04 | Low | High | code-reviewer, test-engineer | SQL shape fixture regex too greedy; relies on adjacent JSDoc. |
| AGG2-L02 = TE2-LOW-03 / PR2-LOW-01 | Low | High | test-engineer, perf | `getImagesLite*` `blur_data_url` exclusion not asserted by any test. |
| AGG2-L03 = SR2-LOW-01 | Low | High | security | No server-side write barrier for `blur_data_url` size/shape (defense in depth). |
| AGG2-L04 = D2-LOW-01 | Low | Medium | debugger | `GROUP_CONCAT(DISTINCT tag.name)` truncates at default 1024 bytes for high-tag-count images. |

## Cross-agent agreement on fix paths

- **AGG2-M01 (blur prefix validation):** Path 1 — add a guard at the consumer + lightweight write-time barrier.
- **AGG2-M02 (audit EXEMPTIONS):** Path 1 — per-file `KNOWN_VIOLATION_COUNT` (cheapest, retains rationale).
- **AGG2-M03 (audit regex coverage):** Path 1 — extend FORBIDDEN regex with HTML `<button>`, `size="icon"`, `cn()` composites.
- **AGG2-M04 (`tag_names` runtime test):** Path 1 — Vitest with seed-style fixtures.
- **AGG2-M05 (perf docs):** Path 1 — update CLAUDE.md and the data.ts docblock.
- **AGG2-M06 (helper extraction):** Path 1 — extract `selectImagesWithTagNames(...)`.
- **AGG2-M07 (CLAUDE.md doc):** Path 1 — add a "Touch-Target Audit" subsection.
- **AGG2-M08 (blur flash):** Path 1 — move `backgroundImage` to motion.div.

## Quality-gate baseline (pre-fix at HEAD `8c4069c`)

- `npm run lint --workspace=apps/web` → exit 0
- `npm run lint:api-auth --workspace=apps/web` → exit 0
- `npm run lint:action-origin --workspace=apps/web` → exit 0
- `npm test --workspace=apps/web` → 63 files / 416 tests passed

## Agent failures

None — all 11 reviewer lenses produced files. Task spawn-agent and
agent-browser tools unavailable in this catalog; reviewers ran inline
with file evidence.

## Convergence prediction

7 MEDIUM + 4 LOW = 11 NEW findings. Cycle 2 will land 9-11
fine-grained commits. Convergence (zero MEDIUM/HIGH new findings)
plausible at cycle 4-5.
