# Test Engineer Review — Cycle 18

**Date:** 2026-06-27
**Baseline:** 2119 pass / 4 skip (end of cycle 17)
**Final:** 2127 pass / 4 skip (+8 new tests)
**Test Health:** HEALTHY

---

## Summary

Cycle 18 focused on:
1. Verifying that all cycle-17 test-gate fixes (GAP-1, GAP-2, GAP-3) are genuinely non-vacuous.
2. Confirming the two newly-added source-contract tests from cycle-17 (DBG-17-1 and PERF-17-04) guard real behavior.
3. Identifying and filling the one genuine unprotected gap: the four focus-visible ring improvements made by the cycle-17 designer had no regression tests.

---

## Existing Gate Verification

### GAP-1 — Smart-collection topic-predicate rename (`topics-actions.test.ts:346-424`)

Non-vacuous. The test builds a real `query_json` containing `{type:'predicate', column:'topic', operator:'eq', value:'old-topic'}`, passes it through the rename loop, and asserts the write-back updates the slug to `'new-topic'`. A mock that returns empty `query_json` would cause the assertions to fail because the update call would never fire.

### GAP-2 — `isAdmin && isP3Pipeline()` gate in `info-bottom-sheet.tsx` (`photo-viewer-no-hdr-download.test.ts:53-66`)

Non-vacuous. The test reads `info-bottom-sheet.tsx` source and asserts the compound guard `isAdmin\s*&&\s*isP3Pipeline\(image\.color_pipeline_decision\)` is present AND that `isP3Pipeline` does not appear ungated (without the `isAdmin &&` prefix). Removing the `isAdmin &&` prefix would break the negative assertion.

### GAP-3 — `SEMANTIC_SCAN_LIMIT` `.limit()` call (`semantic-scan-limit-source.test.ts`)

Non-vacuous. The test asserts `.limit(SEMANTIC_SCAN_LIMIT)` appears in the semantic search route source. Removing the `.limit()` call or hardcoding a literal would fail the assertion.

### DBG-17-1 — Upload-tracker settle-on-throw for topic-SELECT (`images-action-toctou-claim.test.ts`)

Non-vacuous. The test checks that exactly 4 `settleUploadTrackerClaim` rollback calls exist in `images.ts` (disk-insufficient, disk-check catch, topic-query catch, topic-not-found) and that the topic-SELECT catch block specifically calls settle with `(0, 0)` and re-throws. Removing the catch block around the topic SELECT would reduce the rollback count from 4 to 3, failing the count assertion.

### PERF-17-04 — `semanticSearchMode` job snapshot (`image-queue-embed-wiring.test.ts`)

Non-vacuous. The test asserts `resolvedSemanticMode ?? job.semanticSearchMode ?? 'disabled'` appears in `image-queue.ts`. This pattern is the only way the queue worker avoids a per-image `SELECT admin_settings`. Changing the fallback chain or removing `job.semanticSearchMode` from the expression would fail the regex match.

---

## Tests Written

### `apps/web/src/__tests__/focus-visible-rings-cycle17.test.ts` — 8 tests added

**Gap addressed:** The cycle-17 designer pass upgraded four focus-visible rings from non-compliant to WCAG 2.4.11-compliant values. None of those changes had regression protection — a future CSS cleanup could silently revert them.

**Components covered:**

| Component | Element | Before (cycle-17) | After (cycle-17) |
|---|---|---|---|
| `lightbox-color-pip.tsx` | DCI-P3 tooltip trigger | `ring-1 ring-white/50` | `ring-2 ring-white` |
| `lightbox-color-pip.tsx` | copy-metadata button | `ring-1 ring-white/50` | `ring-2 ring-white` |
| `nav-client.tsx` | mobile hamburger toggle | no focus ring | `ring-2 ring-ring ring-offset-2` |
| `wide-gamut-hint.tsx` | dismiss button | `ring-amber-500/40` | `ring-amber-600` |

**Non-vacuousness:** For `lightbox-color-pip.tsx`, positive assertions (`focus-visible:ring-2`, `focus-visible:ring-white`) plus negative assertions (`ring-1` absent, `ring-white/50` absent) plus a whole-file belt-and-braces. For `nav-client.tsx`, three separate assertions (`ring-2`, `ring-ring`, `ring-offset-2`). For `wide-gamut-hint.tsx`, positive (`ring-amber-600`) plus negative (`ring-amber-500` absent). Reverting any of the four ring changes causes at least 2 test failures.

**Anchor precision notes:**
- `viewer.copyColorMetadata` is used as anchor for the copy button (not bare `copyColorMetadata` which matches the function definition at line 88 before the button element at line 302).
- The dismiss button anchor searches _forward_ (`idx` to `idx + 400`) because the JSX attribute order places `className` after `aria-label` for that element.

---

## Coverage Gaps Remaining

### Medium Risk

**M-1: `images.ts` — behavioral test for topic-SELECT throw path**
`images-action-toctou-claim.test.ts` is a source-contract test (reads the file as text). There is no behavioral integration test that calls `uploadImages()` with a mock DB that throws on the topic SELECT and asserts: (a) the upload-tracker claim is settled to `(0, 0)` and (b) the error re-propagates. The source-contract test prevents silent regression in the current structure, but a refactor could evade it. A mock-based behavioral test would require a substantial Drizzle mock harness.

**M-2: `wide-gamut-hint.tsx` — render-condition integration**
The component's visibility logic (`showHint = isWideGamut && displayCapability !== 'p3'`) has no unit test. `use-display-capability.test.ts` covers the hook's Firefox-fallback path independently, but the integration between the hook result and the hint's render decision is untested. A refactor moving the condition could change display semantics silently.

### Low Risk

**L-1: `lightbox-color-pip.tsx` — histogram AVIF-priority branch**
The priority chain (AVIF if P3 display + canvas-P3 → sized JPEG → fallback base JPEG) has no unit test. The branch is visually obvious on a P3 display and adjacent logic is covered in other tests.

**L-2: `nav-client.tsx` — theme and locale-switch buttons missing focus-visible rings**
The theme toggle (line 155-165) and locale-switch button (line 166-172) have no `focus-visible` class. These were not changed in cycle-17 and have no test coverage of that absence. A WCAG 2.4.11 audit pass should add rings and corresponding tests. Risk: Low for regression (no change made), Medium for compliance.

---

## Verification

```
npm test --workspace=apps/web -- --run
Test Files  233 passed | 2 skipped (235)
Tests       2127 passed | 4 skipped (2131)
Duration    17.45s
```

The 4 skipped tests require CLIP model weights on disk (`clip-offline-load.test.ts`, `clip-semantic-integration.test.ts`) — expected in the development environment.
