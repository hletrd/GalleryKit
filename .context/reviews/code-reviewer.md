# Code Review — Cycle 22

**Date:** 2026-06-29
**Reviewer:** oh-my-claudecode:code-reviewer (Sonnet 4.6)
**Commit range:** HEAD since cycle-21 close (R21C21 T1–T6)
**Prior aggregate:** `.context/reviews/archive/cycle-21/_aggregate.md`
**Deferred list:** `.context/plans/cycle-21-deferred.md`

---

## Summary

Cycle 22 delivers exactly six tasks from the cycle-21 plan (T1–T6): 20 focus-visible a11y fixes + a proactive scanner test, a `parseInt`→`Number` fix for topic display-order parsing, a one-line eviction fix for the view-count retry-count map, env-wiring of two CLIP semantic-search operational constants, a regression test for `IMAGE_MAX_INPUT_PIXELS_TOPIC` env-parse, and four CLAUDE.md doc-gap closures. After full code review — spanning all changed files, all new tests, all six deferred items, every empty-catch block, and every cross-cutting invariant (auth guard, rate-limit, privacy fence, ETag, touch-target) — **no new CRITICAL or HIGH findings were identified.** All cycle-21 deferred items are unchanged and their exit criteria remain unmet. The verdict is **APPROVE**.

---

## Findings Table

| ID | Sev | Conf | File:line | One-line |
|----|-----|------|-----------|----------|
| — | — | — | — | No new findings beyond known/deferred items |

No items to detail.

---

## Stage 1 — Spec Compliance

All six tasks from `cycle-21-plan.md` are implemented:

| Task | Plan intent | Implementation | Status |
|------|-------------|----------------|--------|
| T1a | Add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none` to 13 named hover-styled Link/a/button siblings | 20 files changed (covers the named 13 plus 7 additional elements discovered during implementation) | PASS |
| T1b | Add a proactive scanner test (`focus-visible-links-scan.test.ts`) so future additions don't regress | New scanner with 8 self-check tests; walks `components/` + `app/[locale]/`; correctly excludes `group-hover:`, `peer-hover:`, shadcn `<Button>`, `role="option"`, and `group`-parent / `group-focus-visible:` child pairs within 12-line window | PASS |
| T2 | Replace `parseInt(orderStr, 10)` with `Number(orderStr)` + `!Number.isFinite` guard in `createTopic` and `updateTopic` to fix silent scientific-notation mis-parse | `topics.ts:108-112` and `214-218`; test cases added for `'1e3'`→1000 and `'abc'`→0 | PASS |
| T3 | Add `viewCountRetryCount.delete(oldestKey)` alongside `viewCountBuffer.delete(oldestKey)` in the post-flush cap-eviction loop | `data.ts:163-176`; test pinned by regex assertion in `data-view-count-flush.test.ts:170` | PASS |
| T4 | Wire `SEMANTIC_TOP_K_MAX` and `SEMANTIC_SCAN_LIMIT` to `process.env` via `envPositiveInt()` helper | `clip-embeddings.ts:26-31`; 5-case env test added (`clip-semantic-limits-env.test.ts`) | PASS |
| T5 | Add regression test for `IMAGE_MAX_INPUT_PIXELS_TOPIC` env-parse | `process-image-max-input-pixels-env.test.ts`; 4 cases including scientific notation `'64e6'`→64_000_000, invalid inputs fallback | PASS |
| T6 | Close 4 doc-code gaps in CLAUDE.md | CLAUDE.md updated (no code impact) | PASS |

---

## Stage 2 — Code Quality Review

### T1 — Focus-visible fixes (20 files)

All 20 sites add the canonical `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` triplet. Verified:

- **nav-client.tsx line 127**: The topic `<Link>` places `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` in the BASE argument of `cn()` before the conditional `hover:text-foreground hover:bg-muted/50`. The scanner normalizes the full `cn()` call to one logical line and sees the focus-visible token before the hover token — no false negative.
- **lightbox.tsx group pattern**: The `<button className="group ...">` parent is handled by the scanner's `GROUP_PARENT` lookahead (finds `group-focus-visible:ring-2` on the child `<span>` within 12 lines). No regression from the T1 additions.
- **scanner `GROUP_CHILD_WINDOW = 12`**: Sufficient for all group patterns in the codebase; the deepest observed gap is 2 lines (button open → span with group-focus-visible).
- **scanner `INTERACTIVE_OPEN` regex** (`/<(Link|a|button)\b/g`): Correctly excludes uppercase `<Button>` (shadcn), `<span>`, `<div>`, and other non-interactive tags.
- **`normalizeInteractiveTags`**: Multi-line tag normalization is correct. `findJsxTagEnd` tracks string depth and brace depth; the `prev !== '='` guard handles bare `=>` outside braces. The `=ARROW` post-replacement is belt-and-suspenders over the `prev !== '='` guard.
- **No `<a>` elements without `href` with `hover:` styling** exist in the scanned directories. The scanner would flag such elements, but none are present.

### T2 — topics.ts `Number()` fix

Edge-case analysis:

| Input | Old `parseInt(x, 10)` | New `Number(x)` | MySQL INT outcome |
|-------|----------------------|-----------------|-------------------|
| `'1e3'` | 1 (stops at `e`) | 1000 | 1 vs 1000 — **the intended fix** |
| `'1.5'` | 1 | 1.5 → MySQL truncates to 1 | Same result, no regression |
| `''` | NaN → 0 | 0 (finite) → 0 | Same result |
| `'abc'` | NaN → 0 | NaN → 0 | Same result |
| `'1e999'` | 1 (stops at `e`) | Infinity → `!Number.isFinite` → 0 | New correct rejection |
| `'-Infinity'` | NaN (stops at `-`) | -Infinity → `!Number.isFinite` → 0 | New correct rejection |

The `Number.isFinite` guard correctly handles Infinity, -Infinity, and NaN. The `Math.max(-1000, Math.min(1000, order))` clamp remains in place for valid values. No behavioral regression on any existing valid input.

### T3 — viewCountRetryCount eviction fix

The fix (`data.ts:175`, `viewCountRetryCount.delete(oldestKey)`) directly addresses C21-RVW-01: without this, an evicted group that is re-inserted inherits a stale retry count, potentially exhausting `VIEW_COUNT_MAX_RETRIES` after fewer real failures than intended. The fix is a single-line addition in the correct position — inside the `if (oldestKey !== undefined)` guard, after `viewCountBuffer.delete(oldestKey)`. The `while` loop is finite: each iteration reduces `viewCountBuffer.size` by 1, and the `break` on `oldestKey === undefined` is the safe exit. Test coverage is the regex assertion in `data-view-count-flush.test.ts:170`.

### T4 — clip-embeddings.ts `envPositiveInt()` and env wiring

The helper:

```ts
function envPositiveInt(raw: string | undefined, fallback: number): number {
    const n = Number(raw ?? '');
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
```

Correctly handles all rejection cases:
- `undefined` → `Number('') = 0` → `0 > 0` false → fallback
- `'0'` → `0 > 0` false → fallback (0 is invalid topK)
- `'-5'` → `-5 > 0` false → fallback
- `'Infinity'` → `Number.isFinite(Infinity) = false` → fallback
- `'abc'` → `Number.isNaN` → `Number.isFinite(NaN) = false` → fallback
- `'2.5'` → `Math.floor(2.5) = 2` → valid
- `'4e3'` → `Number('4e3') = 4000` → valid

The module-level constants (`SEMANTIC_TOP_K_MAX`, `SEMANTIC_SCAN_LIMIT`) are computed once at import time. The test uses `vi.resetModules()` + dynamic `import()` per case to force module re-evaluation with the new `process.env` value — a correct pattern for module-level constant testing.

The interaction with `clampSemanticTopK` in the semantic search route is correct: `raw=0` (JSON number zero) → `Math.max(SEMANTIC_TOP_K_DEFAULT, Math.min(SEMANTIC_TOP_K_MAX, Math.max(1, 0)))` = `Math.max(20, Math.min(50, 1))` = 20. Zero topK is treated as "use default", not passed through. Intentional behavior per AGG-12.

### T5 — IMAGE_MAX_INPUT_PIXELS_TOPIC test

The test mock `vi.mock('sharp', () => ({ default: Object.assign(() => ({}), { cache: () => undefined, concurrency: () => 1 }) }))` correctly prevents Sharp's native binding from loading. The test only verifies `MAX_INPUT_PIXELS_TOPIC` (a numeric constant computed from env at module load), not any Sharp API behavior. The 4-case coverage is adequate: scientific notation, plain integer, unset default, and invalid fallback.

### Deferred items — cycle-21

All six deferred items are confirmed unchanged and their exit criteria remain unmet:

| ID | Exit criterion check |
|----|---------------------|
| A1 (topics.slug mutable PK) | Still exactly 3 FK children + 1 JSON referrer; no new referrer added in cycle-22 |
| A3 (upload quota settle) | `actions/images.ts` unchanged in cycle-22; still 6 settle sites |
| A4 (restore-maintenance process-local) | `lib/restore-maintenance.ts` unchanged; single-instance topology still the fence |
| A5 (`@/lib/storage` dead module) | `lib/storage/local.ts` unchanged; `storage-quarantine.test.ts` tripwire still active |
| C21-RVW-02 (proxy.ts dead equality branch) | `proxy.ts` unchanged; behavior still correct, nit only |
| TEST21-02 (`IMAGE_CLEANUP_CONCURRENCY` untested) | `actions/images.ts:797` unchanged; `|| 5` fallback still the guard |

### Security — no regressions

- **Auth guard**: No new admin routes or actions added; `lint:api-auth` and `lint:action-origin` gates cover all cycle-22 action files.
- **Privacy fence**: `publicSelectFields` / `_PrivacySensitiveKeys` unchanged; no new columns added.
- **Rate-limit**: No public mutating routes added; `lint:public-route-rate-limit` gate unchanged.
- **Input sanitization**: `Number(orderStr)` in T2 is not less safe than `parseInt`; the `Math.max/min` clamp is unchanged.

### Empty catch blocks — no new regressions

All empty catch blocks verified against the prior cycle analysis. No new empty catches were introduced in cycle-22.

---

## Open Questions (low-confidence, not blocking)

None.

---

## Positive Observations

- **T3 fix precision**: Single-line addition in exactly the right position, with an explanatory comment referencing the review finding (C21-RVW-01). Minimal diff, maximum correctness.
- **`envPositiveInt()` helper design**: Centralized in `clip-embeddings.ts` (the only consumer), avoids a new utility module for a two-liner. `Math.floor()` instead of `parseInt` handles float inputs cleanly and consistently with the cycle-20 env-parse sweep.
- **T1 scanner self-check tests**: The 8 inline self-check tests (`describe('self-check', ...)`) are a high-value addition — they document the scanner's intended boundary conditions and prevent the scanner itself from regressing silently.
- **KNOWN_VIOLATIONS seeded to `{ 'components/search.tsx': 0 }`**: Explicit zero entry for the `role="option"` exemption case documents the design intent without accumulating a false violation debt.
- **All cycle-22 tests use `vi.resetModules()`** correctly for module-level constant testing, avoiding the common pitfall of sharing a stale module singleton across env-variation cases.

---

## Verdict

**APPROVE**

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0 (new; 0 scheduled from prior cycles)
- LOW: 0 (new; all cycle-21 deferred items unchanged)

All six cycle-21 plan tasks are correctly implemented and tested. No new issues beyond the confirmed-deferred list. The codebase is in a consistently high-quality state at HEAD.
