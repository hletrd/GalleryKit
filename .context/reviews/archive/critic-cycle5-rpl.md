# Critic — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

A skeptical, multi-perspective critique of the whole change surface. The codebase has been through 46 review/plan/fix aggregates plus multiple RPL variants. At this saturation, critic findings tend to be structural or meta rather than line-level.

## Structural / meta critiques

### CR5-01 — The `lint:action-origin` gate is defense-in-depth, but the gate's own scanner has a coverage blind spot
- **Severity:** LOW. **Cross-ref:** C5-01 / S5-01.
- **Critique:** the whole point of `scripts/check-action-origin.ts` is to prevent regressions where someone forgets `requireSameOriginAdmin()`. If the scanner silently passes arrow-function exports, the lint provides false confidence — exactly the worst failure mode for a security-oriented gate (better to not have the gate at all than to have one that lies). This is a higher-priority meta issue than its LOW severity suggests, because the gate is load-bearing.
- **Recommendation:** prioritize C5-01 / S5-01 in this cycle even though the severity is LOW — the gate's integrity is more important than most LOW items.

### CR5-02 — `apps/web/src/app/actions.ts` barrel re-export duplicates the "use server" boundary ambiguity
- **Severity:** LOW.
- **File:** `apps/web/src/app/actions.ts`.
- **Critique:** every module-per-domain action file has its own `'use server'` directive. The barrel file `actions.ts` does NOT have `'use server'`; it's a pure re-export. Next.js documents that re-exported server actions work, but the dual-module boundary creates two ways to import the same symbol (`@/app/actions` vs `@/app/actions/auth`). Teams that split on this will fragment over time.
- **Recommendation:** document in a header comment which import path is canonical and why both exist. Or deprecate the barrel. Low priority.

### CR5-03 — Every mutating action starts with a repetitive auth+origin+maintenance preamble
- **Severity:** LOW.
- **Files:** every `src/app/actions/*.ts` entry point.
- **Critique:** a consistent 5-line preamble:
  ```
  const t = await getTranslations('serverActions');
  if (!(await isAdmin())) return { error: t('unauthorized') };
  const originError = await requireSameOriginAdmin();
  if (originError) return { error: originError };
  const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
  if (maintenanceError) return { error: maintenanceError };
  ```
  This is 6 lines repeated 20+ times across the codebase. The repetition is verifiable (the `lint:action-origin` gate enforces one of these), but the readability cost compounds.
- **Mitigation idea:** a `withAdminAction(async (ctx, ...args) => { ... })` higher-order helper would capture the boilerplate. Cycle 4 rpl2 discussed this as AGG4R2-06 for the `stripControlChars` idiom; same pattern applies here.
- **Recommendation:** defer; the boilerplate is understood, typed, and covered by lint. Refactor is risky because auth-critical code paths are hardened by explicit repetition.

### CR5-04 — The deferred-cycle plan directory has 130+ plan files, many overlapping
- **Severity:** LOW.
- **Evidence:** `plan/` contains 133 files including multiple `plan-N-cycleM-fixes.md`, many `NN-deferred-cycleM.md`, and per-feature files. Overlap is inevitable at this point; some plans are one-line notes saying "see prior plan X."
- **Critique:** context cost — when the next orchestrator cycle reads `plan/`, the ambient context pollution is large. ls of 133 items per cycle is not zero cost.
- **Recommendation:** archive fully-implemented plans under `plan/done/` (already exists). Cycle 2 rpl did some of this. Continue the pattern. Every N cycles, compress closed plans. Not a finding — observational hygiene.

### CR5-05 — Review artifacts (`.context/reviews/`) have 250+ files across 46+ cycles
- **Severity:** LOW.
- **Evidence:** same concern as plans. Hygiene opportunity, not a correctness issue.
- **Recommendation:** cycle-to-cycle aggregate files could be compressed to the latest 10-20 cycles; older ones archived. Deferred hygiene.

### CR5-06 — `deleteImages` revalidation fan-out is size-gated at an arbitrary threshold of 20
- **Severity:** LOW.
- **File:** `apps/web/src/app/actions/images.ts:542`.
- **Critique:** the threshold `foundIds.length > 20` is a magic number with no documented reasoning. Why 20? Why not 10, 50, 100? A comment explaining the heuristic (or the perf testing that arrived at 20) would help future readers.
- **Recommendation:** add a brief comment justifying the 20-threshold choice. Cosmetic.

### CR5-07 — The restore-maintenance pattern requires every action to check `getRestoreMaintenanceMessage`
- **Severity:** LOW.
- **Critique:** what happens if a new action forgets to check? The user gets a confusing mid-restore failure instead of the clean "restore in progress" message. There's no lint gate for this (unlike origin). The repeated boilerplate acts as a convention but isn't enforced.
- **Recommendation:** consider adding a third lint helper `lint:action-maintenance` to detect mutating actions that skip `getRestoreMaintenanceMessage()`. Low priority.

### CR5-08 — `data.ts` at 894 lines mixes query + view-count buffering + SEO setting logic
- **Severity:** LOW. Cross-ref AGG4R2-11.
- **Recommendation:** defer — splitting is a refactor risk. Existing deferred.

### CR5-09 — JSON-LD emission sites (`(public)/page.tsx`, `(public)/[topic]/page.tsx`, `(public)/p/[id]/page.tsx`) all repeat the `dangerouslySetInnerHTML` + `safeJsonLd(data)` pattern
- **Severity:** LOW. Cross-ref AGG4R2-09.
- **Recommendation:** a `<JsonLdScript data={...} />` component would consolidate. Existing deferred.

## Multi-perspective note

From a product-risk perspective, cycle 4 rpl2 left the code in excellent shape. The LOW items in this cycle are primarily hygiene, meta-gate integrity, and refactor opportunities. The project has reached a maintenance equilibrium where the RPL loop is finding fewer and fewer net-new issues per cycle.

## Agreement signal for this cycle's aggregate

Expected strong cross-agent agreement on:
- C5-01 / S5-01 / CR5-01 — the arrow-function blind spot in `lint:action-origin` (code-reviewer + security + critic all flag it).
- S5-02 / S5-03 — the SQL scanner gaps (CALL, RENAME USER, REVOKE).

## Summary

9 LOW findings, structural/meta orientation. Prioritize CR5-01 fix per multi-reviewer consensus.
