# Document Specialist — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: doc/code mismatches, external source fidelity.

## Findings

### C4R-RPL2-DOC-01 — `safeJsonLd` docstring is accurate but incomplete [LOW] [LOW]
**File:** `apps/web/src/lib/safe-json-ld.ts:1`

```ts
/** Serialize data for a JSON-LD script tag, escaping `<` to prevent XSS via `</script>`. */
```

Accurate statement of current behaviour, but the function name `safeJsonLd` implies broader safety than the current implementation provides. If the CQ-03/SEC-01 fix lands (U+2028/U+2029 escaping), update doc to: "Serialize data for a JSON-LD script tag, escaping `<` (XSS via `</script>`) and line/paragraph separators (historical JS parser bugs)."

### C4R-RPL2-DOC-02 — CLAUDE.md lists the test surface correctly [POSITIVE]

Verified: `npm test --workspace=apps/web` (Vitest), `npm run test:e2e --workspace=apps/web` (Playwright), `npm run lint --workspace=apps/web`.

All scripts exist in `apps/web/package.json`. `lint:api-auth` and `lint:action-origin` also exist and are listed in the cycle orchestrator's GATES.

### C4R-RPL2-DOC-03 — `db-actions.ts:56-59` comment asserts a fact that CQ-01 may undermine [LOW] [MEDIUM]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:56-59`

```ts
// group_concat_max_len is already set to 65535 on every pool connection
// via poolConnection.on('connection', ...) in db/index.ts — no per-session
// SET needed here (and a per-session SET would be unreliable in a pooled
// environment where the SET and the SELECT may use different connections).
```

The comment is correct in intent (the SET runs per pooled connection). However, the listener's fire-and-forget callback may silently fail. After fixing CQ-01, the comment remains correct but the broader invariant ("SET is actually in effect") needs telemetry. Consider amending the comment to: "Set via `poolConnection.on('connection', ...)` with `.catch()` logging so transient failures are surfaced."

### C4R-RPL2-DOC-04 — Reference to `Context Hub` / `chub` in CLAUDE.md [POSITIVE]

User-level CLAUDE.md mentions `document-specialist` agent checks repo docs first, then Context Hub, then web. Confirmed in plan artifacts that prior cycles used this pattern.

## Confidence Summary

- 3 LOW doc consistency items; 0 mismatches with external sources.
