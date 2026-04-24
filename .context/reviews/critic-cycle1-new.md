# critic — cycle 1 (new)

Multi-perspective critique of the change surface visible at HEAD a308d8c.

## Systemic critique

1. The repo has accumulated a lot of deferred review items across cycles 2–44 and a large plan-archive directory (`plan/done/`). Current HEAD still has the Cycle 6 fixes pending in `plan/cycle6-review-fixes.md` — the plan was written but never executed. The first priority for this cycle is to convert that backlog into a committed green cycle, not to invent new refactors.
2. The auth/provenance gate (`hasTrustedSameOrigin`) is effectively two functions with a "default-loose / explicit-strict" contract. New server actions cannot reasonably discover the strict path unless they audit the existing call sites. Inverting the default makes the strict case the "you get what you asked for" behavior and the loose case an explicit opt-in — a more defensible contract for future additions.
3. The admin top-level layout is the canonical example of "template renders before auth is known" — when the whole tree is server-rendered, the server already knows the user is or is not an admin. Branching once at the layout is cheaper and less error-prone than every child component re-checking.
4. The repo has a large `.context/reviews/` history. Per repo rules (`CLAUDE.md`, `AGENTS.md`), keep diffs small. Do not restructure reviews or plans in the same cycle as a behavior fix.
5. Normalization asymmetry: admin actions sanitize server-side but clients reflect pre-sanitization values. This is a foot-gun for future UX bugs ("why does a refresh change my field?"). A small "return the stored value" contract fixes it generically.

## Specific items (not already flagged by other reviewers)

### CRIT1-01 — No regression guard for the fail-closed provenance contract once flipped
- **Citation:** `apps/web/src/__tests__/request-origin.test.ts:94-106`
- **Severity / confidence:** LOW / HIGH
- **Point:** The existing "compatibility fallback" test locks the current loose behavior. If the default flips, that test must be updated to lock the stricter default *and* keep the `hasTrustedSameOriginWithOptions({ allowMissingSource: true })` opt-in covered. Without both, a future well-meaning PR could revert the fix and still pass.
- **Suggested action:** Tie the flip fix to an explicit test edit in the same commit.

### CRIT1-02 — `seed.ts` legacy slugs are unreachable by any current code path, but still shipped
- **Citation:** `apps/web/src/db/seed.ts:4-10`
- **Severity / confidence:** LOW / HIGH
- **Point:** Either the seed is still used (then the slugs must be valid) or it is dead (then deletion is better than partial fixing). Fixing the slug casing is the minimum change; any broader cleanup should be a separate cycle.

### CRIT1-03 — "Return the stored value" contract deserves one test per action, not per caller
- **Citation:** `apps/web/src/app/actions/{images,seo,settings}.ts` + corresponding client rehydration
- **Severity / confidence:** LOW / HIGH
- **Point:** Reflecting normalized values back to the UI is only valuable if the contract has a test. A single vitest assertion per action (input-with-ctrl-chars → returned sanitized string) is enough; we do not need UI integration tests for this cycle.
