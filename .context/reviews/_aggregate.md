# Aggregate Review — Run 6 / Cycle 6 (review-plan-fix loop)

**HEAD:** `4eb83aab`
**Date:** 2026-06-17
**Agents fanned out (11/11 returned, 0 failures):** code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer

This aggregate dedupes overlapping findings across all 11 agents, preserving the **highest** severity/confidence of any duplicate, and notes cross-agent agreement (multi-agent corroboration = higher signal). Per-agent files retained as-is for provenance. This is a FRESH cycle-6 fan-out that overwrote the stale partial review files left by an interrupted prior attempt.

---

## Headline

**Continued honest convergence, two real low-blast-radius findings.** Cycle 6 of a system that has closed ~58 findings across runs 4–6. The findings trend across this run is **11 → 45 → 14 → 5 → 1 → 2**. Nine of eleven agents returned ZERO actionable findings and independently re-confirmed at HEAD `4eb83aab` that the prior-cycle closures hold. The two exceptions are:

1. **DES-C6-M1 (MEDIUM, High)** — the visible **"HDR" badge fails WCAG 1.4.3 (AA) color contrast**: `text-white` on a `from-amber-300 to-orange-400` gradient measures **1.44:1** at the light stop (2.26:1 at the right stop) where 4.5:1 is required for the 10–12 px bold glyph. Four sites. This is a **latent carry-forward**, not a fresh regression (the UI surface is byte-identical to the cycle-5 clean baseline). It slipped 5+ cycles because no prior pass ran the contrast calculator on a *gradient* background. **Admin-only surface** (badge gated on `isAdmin && isHdr`), which bounds the audience but does not exempt it from the AA contract the repo enforces elsewhere.
2. **DBG-C6-01 (LOW, High)** — a **test-only false-negative** in the client→server-only boundary classifier (the file that IS this run's HEAD commit). The new AST walk iterates `sf.statements` and handles only `ImportDeclaration`/`ExportDeclaration`; it silently drops dynamic `import('@/lib/data')` (`CallExpression`) and `import x = require('@/db')` (`ImportEqualsDeclaration`) — two value-import forms the prior regex captured — narrowing a security-boundary guard in the false-negative direction. Trigger surface is empty at HEAD (grep-confirmed: no `'use client'` module uses those forms against `@/lib`/`@/db`), so it is correctly LOW.

Both findings are HEAD-verified by the orchestrator (contrast math computed; classifier gap and empty trigger surface reproduced). No security/correctness/data-loss landmine survived verification.

- **security-reviewer:** Risk LOW. 0 Crit / 0 High / 0 Med / 0 Low new. Cycle-5→HEAD delta touches exactly ONE file (`client-server-only-boundary.test.ts`, test-only) — security-neutral. All 3 lint gates PASS. `npm audit` = 8 advisories, ALL dev/build-time; the one prod-tree transitive (`postcss<8.5.10`, GHSA-qx2v-qp2m-jg93) re-confirmed NON-EXPLOITABLE (build-time CSS stringify, no runtime attacker path); `--force` correctly not run (would downgrade Next 16→9). Crown-jewel files (session/tokens/Stripe/serve-upload/db-actions/proxy/api-auth/CSV/validation/GPS-strip/privacy guards) read in full and confirmed hardened. Zero hardcoded secrets; no `exec`/`eval`/`new Function`.
- **perf-reviewer:** 0 new. Since the cycle-4 perf baseline only 2 shipping files changed (`backfill-color-pipeline.ts` — two pure O(batch) helpers in the advisory-locked operator sidecar; `switch.tsx` — comment-only). All 14 hot-path files byte-identical to baseline. No N+1 (shared `tagNamesAgg` GROUP_CONCAT), every listing/nav/topic/tag query index-covered, view-count buffer bounded, SW LRU is O(k) head-walk, all rate-limit maps hard-capped. The one intentional `getImagesForFeed` filesort on `updated_at` (`data.ts:771`) surfaced as awareness-only, explicitly NOT a finding (bounded/cacheable Atom feed at personal-gallery scale).
- **code-reviewer:** 0 actionable / 0 cosmetic. Read both backfill paths, `image-queue`, `serve-upload`, the semantic route, checkout, Stripe webhook, download, LR-upload, `data.ts` privacy guards + view-count buffering, `process-image.ts` resolvers, all JSON.parse sites, `validation.ts`. Codebase-wide sweeps clean (no missing-radix parseInt, no unguarded JSON.parse, no empty catch, no N+1 sequential awaits, full action-origin coverage). Five candidates investigated and ruled out with evidence. APPROVE.
- **critic:** ACCEPT, 0 findings. All seven challenged whole-system invariants verified from code (not comments/tests) and each HOLDS: privacy compile-guards (21-key union ⇄ `publicSelectFields` resolves `never`), action-origin/api-auth (3 gates PASS + glob-completeness), migration journal-hash post-condition (fail-loud intact), 6 advisory locks (no two held simultaneously, no deadlock cycle), ETag/settings-hash (9 `COLOR_IMPACTING_KEYS`), HDR honesty (admin-only AND badge-gated), blur-data-url (producer/write/read symmetric). Transparently disclosed a stale-vitest-cache false alarm (`latitude` appeared to leak) and DISQUALIFIED it via runtime key probe + clean typecheck + `--no-cache` re-run — recorded as an unscored test-reliability smell, not a finding.
- **verifier:** 18/18 load-bearing claims VERIFIED, 0 CONTRADICTED, 0 UNVERIFIABLE. **Unit suite: 2181 passed / 2 skipped / 0 failed** (233 files), exit 0; typecheck exit 0 (app + scripts); ESLint exit 0; all 3 security lint gates exit 0; i18n parity 840 = 840 identical key sets. Privacy compile-guard EMPIRICALLY PROVEN (synthetic `latitude` leak → documented `TS2322` compile failure → reverted with zero residue). `IMAGE_PIPELINE_VERSION=7`, 6 sizes, 9 `COLOR_IMPACTING_KEYS`, 6 advisory locks, Cache-Control trio, ETag format all confirmed. The 2 skipped tests = CLIP integration self-skipping on `CLIP_INTEGRATION !== '1'` (intentional env-gate).
- **test-engineer:** 0 new. Suite ran 43s (no contention flake this run), 2181 pass / 2 skip / 0 fail. The cycle-5 finding (AGG-C5-01) closed correctly — boundary test widened to AST classifier + `mysql2`-in-closure detection, left `@/db` WITHOUT `server-only` (HARD GUARD #1 respected). All 12 CLAUDE.md locked-contract tests exist and are non-vacuous. Every recent source change has a paired regression test. Zero raw-timer sleeps; every `vi.waitFor` carries explicit `{ timeout, interval }`.
- **tracer:** 0 actionable, 6 verified-CLEAN flows + 1 INFO. Traced (competing hypotheses, file+line + test evidence): backfill detection-failure walk-back SOUND (`slice(items.length)` exact, walk-back cannot underflow); Stripe `async_payment_succeeded` gap CLOSED operationally by `payment_method_types:['card']` (test-locked) + webhook `payment_status !== 'paid'` second wall, single-use claim atomic (`WHERE downloadedAt IS NULL`), no double-spend/replay; ETag invalidation CLEAN both paths (serve-upload folds 9 keys immediately, static rides mtime+size which the mandatory post-flip backfill rewrites); upload→process→delete race CLEAN (per-image lock + `affectedRows===0` cleanup backstop, encoder last writer); session+token single-use CLEAN (timingSafeEqual before shape regex, anti-oracle); view-count swap-before-write CLEAN (no double-count, bounded loss).
- **architect:** 0 architecture findings. Boundary clean across all `'use client'` files; cycle-5 fix sound + non-vacuous (GREEN); storage abstraction fully dead; config chain acyclic correctly-layered; single-writer process-local state unchanged. Independently surfaced DBG-C6-01 as a cross-agent corroboration (guard-strengthening test fix, not architecture). (Agent is read-only; review persisted by orchestrator after independent HEAD verification.)
- **debugger:** **1 LOW (DBG-C6-01)** + 0 Med/High/Crit. The HEAD commit's AST classifier rewrite dropped dynamic-import / import-equals value forms (false-negative narrowing of the boundary guard); LOW because trigger surface is empty today. Everything else clean after full re-read + crafted-input analysis: backfill accounting + `resolveBackfillConcurrency` (no NaN/underflow), all GPS/ICC/ISOBMFF/gain-map bounded walkers (bounds + cycle guards + 64-bit overflow guards + fail-safe null→re-encode), Sharp catch/finally (no orphan/fd leak), SW LRU, bounded rate-limit maps + login TOCTOU. `parseInt`-without-radix audit: zero hits. typecheck exit 0; 105/105 targeted tests pass.
- **document-specialist:** 0 actionable / 1 harmless INFO. 35 distinct load-bearing CLAUDE.md facts re-verified against code at HEAD — all PASS (`IMAGE_PIPELINE_VERSION=7`, 6 sizes, 11 admin-tunable defaults, `COLOR_IMPACTING_KEYS=9` with the AGG-R7-08 note, 6 advisory locks, Cache-Control trio across serve-upload/next.config/nginx, ETag format, Argon2id params, rate-limit 5/15min, upload caps 200 MiB/2 GiB/100, SW 50 MB LRU, `tagNamesAgg`, migration-journal non-monotonicity, library versions Next 16.2.x/React 19/TS 6/Node ≥24). i18n en 840 = ko 840, ko-no-plural asymmetry intentional (DOC-R5C3-07), NOT flagged. The injected CLAUDE.md snapshot was stale ("5 keys"); the on-disk file at HEAD is correct ("9").
- **designer:** **1 MEDIUM (DES-C6-M1)** + 0 Crit/High/Low. Static source review (MySQL absent → data routes can't render). Touch-target audit 15/15 PASS. The HDR badge contrast failure (above) is the only white-on-light occurrence in the entire components+admin tree (targeted sweep confirmed). Verified clean: `--destructive-text` token AA all themes; histogram clip labels + sRGB-clipped hint AA both themes; `switch.tsx` 44 px hit area + 20 px thumb travel; reduced-motion (global duration zeroing + hover-scale suppression); forced-colors (system color pairs); lightbox/pip/color-details/wide-gamut-hint keyboard/focus/ARIA unchanged from clean baseline.

---

## MERGED FINDINGS (deduped, severity = max across agents)

### CRITICAL
*(none)*

### HIGH
*(none)*

### MEDIUM (fix this cycle)

#### AGG-C6-01 (DES-C6-M1) — "HDR" badge text fails WCAG 1.4.3 AA contrast on its amber gradient (MEDIUM, High)
- **Agents:** designer (DES-C6-M1). Independently HEAD-verified by orchestrator (contrast math computed below).
- **Files (4 sites, all `text-white` on `bg-gradient-to-r from-amber-300 to-orange-400`):**
  - `apps/web/src/components/color-details-section.tsx:526` (carries `.hdr-badge` class)
  - `apps/web/src/components/lightbox-color-pip.tsx:151` (carries `.hdr-badge` class)
  - `apps/web/src/components/info-bottom-sheet.tsx:278` (NO `.hdr-badge` class)
  - `apps/web/src/components/image-manager.tsx:526` (NO `.hdr-badge` class)
- **Problem:** White text on the amber-300 (light) gradient stop is **1.44:1**; on the orange-400 stop **2.26:1**. WCAG 2.2 SC 1.4.3 (Contrast Minimum, Level AA) requires 4.5:1 for normal text; the glyph is 10–12 px bold (`text-[10px] font-bold` / `text-xs font-bold`), which is NOT "large text" (large = ≥18.66 px bold or ≥24 px). The badge text is therefore below the AA floor across the entire gradient. The repo enforces AA elsewhere (destructive-text token, histogram labels, recent contrast fixes), so this is an out-of-policy gap, not an accepted exemption.
- **Orchestrator-verified contrast math (sRGB WCAG luminance):** white/amber-300 = **1.44:1** (FAIL); white/orange-400 = **2.26:1** (FAIL); **amber-950**/amber-300 = 10.39:1, amber-950/orange-400 = **6.62:1** (PASS at worst stop); amber-900/amber-300 = 6.29:1, amber-900/orange-400 = **4.01:1** (still FAIL at worst stop — `text-amber-900` must NOT be used).
- **Blast radius:** Admin-only (badge gated on `isAdmin && isHdr`). Affects every admin viewing an HDR-flagged photo's badge — and at the two non-`.hdr-badge` sites the low-contrast glyph renders on any display, not just HDR-capable ones (the `.hdr-badge` CSS class is not what controls the text color here; the inline `text-white` does). No end-user exposure today, but the AA contract is unconditional in this repo.
- **Fix (1-token change × 4 sites):** replace `text-white` → `text-amber-950` on all four badges (worst-stop 6.62:1 PASS). Do NOT use `text-amber-900` (orange-400 stop is 4.01:1, still failing). Tailwind v3.4.19 confirmed (sRGB gradient interpolation, so the worst-stop model is correct — not v4 oklab). Add a one-line worst-stop fixture (assert the badge source does NOT pair `from-amber-300 to-orange-400` with `text-white`) so it cannot silently regress again. No existing test pins the current `text-white` value, so the change is test-safe.
- **Confidence:** High (contrast values independently computed; all four sites grep-confirmed at HEAD; fix value verified to pass at the worst gradient stop).
- **History:** Carry-forward from `e444f30e` (2026-05-08), a mislabeled "contrast bump" that inverted a previously-passing `amber-700-on-amber-100`. UI surface byte-identical to cycle-5 clean baseline (`git diff 2f603716..HEAD` over tsx/css/messages empty), so this is a pre-existing latent defect surfaced now, not a regression introduced this run.

### LOW (fix this cycle)

#### AGG-C6-02 (DBG-C6-01) — Client→server-only boundary classifier misses dynamic-import & import-equals value forms (LOW, High)
- **Agents:** debugger (DBG-C6-01), corroborated by architect (cross-agent note in architect.md §1). Independently HEAD-verified by orchestrator (classifier reads `sf.statements` only; empty trigger surface grep-confirmed).
- **File:** `apps/web/src/__tests__/client-server-only-boundary.test.ts` — `extractAliasedImports` (lines ~143–185). This test file IS this run's HEAD commit `4eb83aab`.
- **Problem:** The cycle-5 fix replaced a regex import extractor with a TypeScript AST walk. The walk iterates `sf.statements` and matches only `ts.isImportDeclaration` / `ts.isExportDeclaration`. It therefore does NOT traverse:
  - dynamic `import('@/lib/data')` — a `CallExpression`, the natural code-split for a heavy server/data module;
  - `import db = require('@/db')` — an `ImportEqualsDeclaration`.
  Both forms were captured by the old regex (orchestrator reproduced the divergence: old regex → `['@/lib/data']`, new AST → `[]`). This narrows a security-boundary guard in the **false-negative** direction: a future `'use client'` module doing `await import('@/lib/data')` would pass this test GREEN despite leaking the `@/lib/data → @/db → mysql2` chain into the client bundle.
- **Why LOW (not Med/High):** the trigger surface is empty at HEAD — the only dynamic `import('@/lib|@/db')` sites are in `src/instrumentation.ts` (server `register()`, not `'use client'`, unreachable from any client closure), and there are zero `import = require('@/lib|@/db')` sites. So today's boundary is genuinely clean (architect verdict unchanged); this is latent future-coverage hardening.
- **Fix (test-only, ~10 lines):** in `extractAliasedImports`, after the statement loop add a `ts.forEachChild` subtree visit that also captures (a) `ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword` with a string-literal first argument that `isAliased`, and (b) `ts.isImportEqualsDeclaration(node)` whose external module reference is an aliased string literal. Add a non-vacuous pin (a fixture string using `await import('@/db')` that the extractor must return). Pure test change — no production behavior, no HARD-GUARD interaction (does NOT add `server-only` to `@/db`).
- **Confidence:** High (gap reproduced by running both extractors; empty trigger surface grep-confirmed; fix mechanism is a standard AST descent).

---

## INFO / VERIFIED-CORRECT (not findings — provenance only)

- **tracer (6 INFO):** backfill walk-back SOUND; Stripe async-payment gap closed operationally (card-only pin + webhook gate); ETag invalidation CLEAN both paths; upload→process→delete race CLEAN; session+token single-use CLEAN; view-count swap-before-write CLEAN.
- **document-specialist (1 INFO, DOC-C6-INFO-01):** CLAUDE.md line 264 cites `settings-hash.ts:37-49` for the `COLOR_IMPACTING_KEYS` array, which actually lives at lines `41-53` — a 4-line drift of exactly the "informational only" class the repo's own docs disclaim. Symbol name is unambiguous and the count (9) + breakdown are correct, so it cannot mislead. No fix required (optional cosmetic only).
  - *Orchestrator correction:* the tracer also flagged "the `settings-hash.ts` inline comment says 5" — that is itself mistaken. The on-disk comment at `settings-hash.ts:4` says "the **9** settings" and the array has 9 keys. Code, inline comment, and CLAUDE.md count all agree on 9. The only real drift is the cosmetic line-number citation above. No code or doc change is warranted (line refs are repo-disclaimed as informational).
- **critic (test-reliability smell, unscored):** a warm vitest cache made `privacy-fields.test.ts` transiently appear to report `latitude` in the public set; disqualified as a stale-cache tooling artifact (runtime key probe + clean typecheck + `--no-cache` 13/13 PASS in both orderings), NOT a code defect. Recorded for awareness only.
- **perf-reviewer (awareness, not a finding):** `getImagesForFeed` (`data.ts:771`) filesorts on `updated_at` (no `(processed, updated_at)` index) — intentional, bounded, cacheable Atom feed; adding an index would be a speculative micro-opt with write cost.
- **security-reviewer:** `postcss<8.5.10` transitive prod advisory (GHSA-qx2v-qp2m-jg93) — NON-EXPLOITABLE (build-time CSS stringify only; no runtime attacker path). Tracked, no change. `npm audit fix --force` rejected (would downgrade Next 16→9). 7 other advisories are dev/build-time only.

---

## CROSS-AGENT AGREEMENT MAP

- **DBG-C6-01 (boundary classifier gap):** debugger (primary) + architect (corroboration). Two agents, same conclusion + same LOW severity (empty trigger surface) → high signal.
- **HARD GUARD #1 (`@/db` no `server-only`):** security-reviewer, architect, test-engineer, debugger all independently confirmed it is correctly NOT applied and the `mysql2`-in-closure detection is the safe substitute. Strong multi-agent agreement; do not reopen.
- **9 `COLOR_IMPACTING_KEYS`:** verifier + document-specialist + critic + tracer all confirmed code = 9; the orchestrator brief's "5" hint is stale.
- **Convergence:** 9/11 agents at literal zero actionable findings, with the two exceptions both low-blast-radius (one admin-only a11y carry-forward, one empty-trigger-surface test hardening).

---

## AGENT FAILURES
*(none — all 11 agents returned on the first attempt; no retries needed)*
