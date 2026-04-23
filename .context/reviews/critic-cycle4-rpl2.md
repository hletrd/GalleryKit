# Critic — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: multi-perspective critique of the whole change surface.

## Findings

### C4R-RPL2-CRIT-01 — Review fatigue in `.context/plans/` directory [LOW] [HIGH]

**Observation:** `ls .context/plans/` returns >200 plan files, many with overlapping or stale scopes (`plan-62-cycle16-fixes.md`, `plan-63-cycle17-fixes.md`, ..., `plan-157-cycle10-r3-fixes.md`, `plan-201-cycle1-review-fixes.md`). The `done/` archive exists but the live directory still accumulates. This makes it hard to tell at a glance which items are actionable versus finished.

**Recommendation:** The plan-writing phase of this cycle should (a) archive any 100%-complete plan whose boxes are all ticked into `done/`, and (b) resist creating yet another numbered plan if an existing plan can absorb the new scope.

### C4R-RPL2-CRIT-02 — `stripControlChars` is called in 14+ places with the same idiom [LOW] [MEDIUM]

**Observation:** Every server action does:
```ts
const clean = stripControlChars(raw) ?? '';
if (clean !== raw) return { error: t('invalidX') };
```

**Critique:** This is a copy-paste pattern. A small helper — e.g. `requireCleanInput(raw: string, invalidMsg: string): string | { error: string }` — would reduce the ~40 repeated lines and make drift impossible (new actions that forget the `clean !== raw` check). Not a blocker.

### C4R-RPL2-CRIT-03 — JSON-LD surface is hand-constructed at three call sites with almost-duplicate code [LOW] [LOW]

**Observation:** `home` page, `[topic]` page, `p/[id]` page all manually construct JSON-LD blocks with `safeJsonLd(data)` inside `dangerouslySetInnerHTML`. A shared `<JsonLdScript data={...} />` component would consolidate the escape contract in one place. If `safeJsonLd` gets hardened (see CQ-03/SEC-01), only one file needs changing.

### C4R-RPL2-CRIT-04 — `actions.ts` barrel is inconsistent [LOW] [MEDIUM]

Duplicate of CQ-02 — settings actions not re-exported. Either deprecate the barrel or make it complete.

### C4R-RPL2-CRIT-05 — Defensive programming in `extractExifForDb` may swallow upstream bugs [LOW] [LOW]
**File:** `apps/web/src/lib/process-image.ts:462-588`

The EXIF extractor has many `typeof x === 'number'` guards that silently return `null`. This is correct defensively but in dev it hides where cameras output weird data. Consider gating a dev-mode `console.debug` on unexpected shapes so maintainers can build a library of edge cases. Not in scope for this cycle.

## Confidence Summary

- 5 LOW findings; 0 blockers.
