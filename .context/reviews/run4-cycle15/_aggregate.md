# Aggregate review — Run-4 Cycle 15

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c14). Each angle was executed as a
distinct full-inventory in-context pass; no angle sampled. Inventory:
independent line-level regression review of the three cycle-14 fix
commits (`b7877c8c`, `beb5c64f`, `82e35324`); rotation to the
zero-run-4-coverage surfaces by a fresh mention-count coverage map over
run4-c1..c14 review texts — the **app shell / error / navigation
cluster** (root+public+admin layouts, error boundaries ×3 +
global-error, not-found, nav/nav-client/admin-nav/admin-header/footer,
theme/i18n providers, loading ×4, icon routes), the **micro-lib
rotation** (image-types, clipboard, theme, safe-json-ld, photo-title,
bounded-map, upload-paths, upload-filenames, password-hashing,
color-pipeline-decisions, constants, utils, hdr-filenames,
bulk-edit-types, clip-embeddings, clip-inference, db-restore,
sql-restore-scan, download-interstitial, error-shell), and the
**storage + map + filter cluster** (storage/types, storage/local,
map-loader, map-client, map page, tag-filter, topic-empty-state,
login-form); pattern sweeps (sub-44 `min-h-[NNpx]`, ui-primitives
drift/suppressions).

## Context
C14 closed the wide-gamut predicate triplication on the color-audit
clients. C15's coverage rotation landed on the app shell and the public
map — and found a fourth instance of the loop's recurring failure mode
in two new costumes: a canonical helper/idiom exists (theme contract in
`lib/theme.ts`; sized-thumbnail idiom R21/R22/R23-M1; 44 px floor with
blocking audit) and a surface built before/outside it silently
diverges (`global-error` models 2 themes of 4; map popup fetches
full-res bytes and bypasses `imageUrl`; tag chips present 32 px through
an audit-invisible shape).

## Cross-angle agreement
- **COR-R4C15-01** — flagged by code/debugger/tracer (full causal
  trace: themes array → next-themes class → `.oled` CSS →
  `detectDarkMode` misses → white shell), security (no security
  consequence), critic (fix-shape: pure-helper extraction mirroring
  `resolveErrorShellBrand`, not an inline patch), verifier (CONFIRMED,
  every chain link source-verified), test-engineer (zero coverage on
  inline detection — exactly why it shipped), document-specialist
  (contradicts `lib/theme.ts` THEME_VALUES contract), designer
  (theme-fidelity defect on the fatal-error surface). **6/6 angles.**
- **PERF-R4C15-02** — perf/architect (primary: full-res fetch +
  unbounded-vs-target pixel arithmetic), code (only `src/` image
  surface bypassing `imageUrl()` → CDN break), security (no privacy
  consequence — public derivative), critic (fix-shape: mirror
  SearchResultItem; pass real `imageSizes`, no DEFAULT_IMAGE_SIZES
  shortcut), verifier (CONFIRMED), document-specialist (R23-M1 idiom
  documented in search.tsx header), test-engineer (source-inspection
  lock proposed). **6/6 angles.**
- **DES-R4C15-03** — designer (primary), test-engineer (audit
  structurally blind: normalizer excludes `Badge`, FORBIDDEN excludes
  arbitrary values — TEST-R4C15-02), architect (gate-erosion failure
  mode), code (concurs), critic (44 px pills are the established
  language: nav topic pills already `min-h-[44px]`; pseudo-element
  hit-zones would overlap 8 px rows), verifier (CONFIRMED + verified
  the audit extension lands with zero new exemptions). **6/6 angles.**
- **DES-R4C15-04/05/06** — designer (primary), code concurs. 2/6 each.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C15-01 | **MED(LOW)/High (CONFIRMED)** | `app/global-error.tsx:44-47,61` renders the LIGHT error shell for `oled`-theme users: `detectDarkMode()` checks only the `dark` class while the 4-theme system (`lib/theme.ts` THEME_VALUES; `globals.css:70` `.oled`) applies class `oled` — a fatal error in true-black mode flashes a white page. Fix: extract pure `resolveErrorShellThemeClass()` → `lib/error-shell.ts` (`'oled' | 'dark' | null`), apply on the rendered `<html>`, lock in `error-shell.test.ts`. | 6/6 |
| PERF-R4C15-02 | **MED/High (CONFIRMED)** | `components/map/map-client.tsx:91-99` popup `<img>` downloads the full-resolution base JPEG (multi-MB) for a 120×80 thumbnail AND bypasses `imageUrl()` (breaks `IMAGE_BASE_URL` CDN deployments on exactly this surface). Fix: plumb `imageSizes` (map page `getGalleryConfig()` → MapLoader → MapClient), render via `MarkerThumb` mirroring the R23-M1 sized-URL + one-shot onError fallback idiom; source-inspection lock. | 6/6 |
| DES-R4C15-03 | **MED(LOW)/High (CONFIRMED)** | `components/tag-filter.tsx:62,79` public home filter chips are 32 px-tall `<button>`s (`min-h-[32px]` via `<Badge asChild>`) — below the blocking 44 px policy, in a shape invisible to the audit. Fix: `min-h-11` chips + audit extension (normalizer covers `Badge`; FORBIDDEN catches sub-44 arbitrary `min-h-[NNpx]` on Button/button/Badge-asChild) + failing fixtures + compliant fixtures. Folds in TEST-R4C15-02 and triggers the OBS-R4C14-A prose-refresh exit criterion. | 6/6 |
| DES-R4C15-04 | LOW/High (CONFIRMED) | `components/admin-nav.tsx:37` nine admin nav links at `min-h-10` (40 px). Fix: `min-h-11`. | designer, code |
| DES-R4C15-05 | LOW/High (CONFIRMED) | `components/footer.tsx` GitHub + Admin links at text height (~20 px) on every public page's mobile footer. Fix: `min-h-11 items-center` (+ `inline-flex` on the Admin link). | designer, code |
| DES-R4C15-06 | LOW/High (CONFIRMED) | `admin/(protected)/error.tsx:16-17` nested `<section>`s both `aria-labelledby="admin-route-error-title"` → duplicate identically-labelled regions for AT. Fix: outer becomes `<div>`. | designer, code |
| TEST-R4C15-01 | gap/High | No lock on global-error theme detection — folds into COR-R4C15-01 (helper extraction + tests). | test |
| TEST-R4C15-02 | gap/High | Touch-target audit blind to `asChild` slot wrappers + arbitrary-value classes — folds into DES-R4C15-03. | test, architect |
| TEST-R4C15-03 | gap/Medium | Map thumbnail URL derivation unlocked — source-inspection fixture (folds into PERF-R4C15-02). | test |
| PERF-R4C15-B | LOW impact / Medium conf | `getMapImages()` unbounded (no LIMIT; per-marker DOM; `Math.min(...lats)` spread) — fine at personal-gallery scale; clustering is a product decision. DEFER with exit criteria (marker count ≳2k or map payload complaints). | perf |
| OBS-R4C15-A | LOW/Low (NEEDS VALIDATION) | `p/[id]/loading.tsx:16` lazy sessionStorage read can mismatch the SSR'd Suspense fallback on a hard load with a stale lightbox flag; bounded blast radius (client re-render of the fallback). DEFER with exit criterion (hydration-warning reports / observed flash). | code |
| DOC-R4C15-01/02 | INFO/High | Code-vs-doc deltas resolved BY the fixes (theme contract; R23-M1 idiom); CLAUDE.md touch-target prose gains one line for the new audit patterns in the same commit. | document |

## Regression review of cycle-14 commits — SOUND
`b7877c8c` (helper semantics verified: false for null/'unknown'/'bt709';
delivered-row swap equivalent over the persisted enum domain),
`beb5c64f` (bounds preserved; urim behavior unchanged), `82e35324`
(await-then-close correct; handleDelete settles on success AND error;
ESC/overlay/Cancel inert mid-flight; no stuck-open path). No follow-on
work.

## Clean-pass surfaces this cycle
Full lists in the per-angle files. Highlights: `storage/local.ts`
traversal/symlink audit clean; `sql-restore-scan.ts` no bypass found;
GA injection nonce'd + validated; map GPS privacy double-gated and
test-locked; bounded-map/upload-paths/upload-filenames/password-hashing/
clip-*/db-restore/download-interstitial/login-form clean;
layouts/loading/skip-links/not-found a11y clean; ui-primitives drift
scan clean.

## Standing deferrals re-audit (exit criteria)
Diff since the c14 review commit (`c49e4a7c..HEAD`) touches only
plan-299 progress notes — deferral surfaces untouched, EXCEPT:
- **OBS-R4C14-A / DOC-R4C14-03 — exit criterion FIRES this cycle**:
  DES-R4C15-03 makes a functional edit to
  `touch-target-audit.test.ts`, which is the recorded trigger ("the
  next functional edit … refreshes the FORBIDDEN/exemption narration
  to the post-lift Button defaults and re-evaluates retiring the
  pure-`size="icon"` KNOWN_VIOLATIONS entries"). Verified
  `ui/button.tsx` ships 44 px floors on ALL size variants
  (`min-h-11`/`size-11`/`min-h-12`/`size-12`). Decision for the fix
  commit: refresh prose; KEEP the bare `size="sm"`/`size="icon"`
  patterns and their exemption entries as documented belt-and-braces
  against a future `button.tsx` variant downgrade (the audit cannot
  see variant CSS), with comments updated to say exactly that.
- DEF-R4C11-A, DEF-R4C10-A/B, DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01
  (LR PAT), OPS-R4C6-01 (host nginx `/uploads/`), DEF-R4C8-A/B/C/D,
  histogram mode-cycle aria-label, OBS-R4C12-B/C/D/E, DOC-R4C13-01/02,
  RISK-R4C14-03 + TEST-R4C14-02 (gain-map device fixture) — all
  un-triggered. Remain deferred/recorded.

## Gate baseline (clean tree)
Cycle-14 close: vitest 184 files / 1759 tests green; all 8 gates green;
deploy verified live. All 8 gates re-run during PROMPT 3 after this
cycle's fixes land.

## HARD-SCOPE check
No finding proposes edit / culling / scoring / preset features. All
scheduled fixes tighten existing surfaces' fidelity (theme), efficiency
(bytes-per-pixel), or accessibility (target size, region labels).

## AGENT FAILURES
None — all six angle passes completed (single-subagent in-context
execution; no nested agent spawns attempted because the Agent tool is
unavailable in this environment, per the documented run-wide
constraint).
