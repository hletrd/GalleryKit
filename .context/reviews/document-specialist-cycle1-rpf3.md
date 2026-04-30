# document-specialist — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Doc/code mismatches around designer-v2 findings.

## Findings

### DS-1 (Low, High confidence) — `data.ts:309-313` docblock will be misleading after JOIN-path fix

If we switch to LEFT JOIN + GROUP BY (Path 1, the fix recommendation),
the docblock at line 309-313 contradicts the implementation.
**Action:** Update docblock to reflect the new rationale ("uses LEFT
JOIN + GROUP BY because the correlated subquery pattern caused silent
null returns; perf is acceptable on personal-gallery scale").

### DS-2 (Low, Medium confidence) — CLAUDE.md doesn't document touch-target floor

Codifying the 44 px rule as a one-liner under "Performance Optimizations"
or a new "UI Constraints" section would make it visible to future
agents. Optional small doc update.

### DS-3 (Low, Medium confidence) — `_aggregate-cycle3-loop.md` claims convergence prematurely

Cycle 3 aggregate ran without the designer lens being deep enough to
catch the 32 px LightboxTrigger or the null `tag_names`. designer-v2
used live agent-browser DOM measurements and RSC payload inspection.
**Process note:** designer review depth must include live DOM
measurement and (where possible) RSC payload inspection.

## Verdict

DS-1 is implementation-coupled. DS-2 / DS-3 are optional/process notes.
