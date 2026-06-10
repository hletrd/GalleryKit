# Perf + architect + document-specialist + designer — Run-4 Cycle 1

Method: import-graph analysis of serving hot paths, LR-vs-browser architectural parity,
doc-vs-code diff of CLAUDE.md / AGENTS.md against package.json + scripts/, static UI/a11y
pass over the new tokens admin surface + pattern sweeps (`dangerouslySetInnerHTML` all
safe-JSON-LD via `safe-json-ld.ts`; `target="_blank"` sites carry `rel` on the following
line — verified; raw `matchMedia` uses are reduced-motion/hover probes, NOT gamut probes,
consistent with R9-R1).

## Findings

### PERF-R4C1-07 — `serve-upload.ts` pulls the sharp encoder graph for one constant
- **Severity/Confidence: MEDIUM (perf) + HIGH as gate failure / High**
- **Where:** `apps/web/src/lib/serve-upload.ts:7`.
- Image-serving routes (`app/uploads/[...path]/route.ts` + localized twin) load
  `process-image` (sharp native bindings, color-detection, ICC parsers) at module init
  purely for `IMAGE_PIPELINE_VERSION`, which `process-image.ts:294` itself re-exports from
  `gallery-config-shared.ts:21`. Cold-start of the first image request pays the sharp
  load; the vitest gate times out on the same chain (see test-engineer TEST-R4C1-07).
- **Fix:** import from `@/lib/gallery-config-shared`. (Other importers — image-queue,
  actions/images, LR route, backfill runner — legitimately need process-image functions;
  no change there.)

### ARCH-R4C1-11 — LR route revalidates the whole app per single-file publish
- **Severity/Confidence: LOW / Medium**
- **Where:** `route.ts:396` `revalidateAllAppData()` vs browser
  `images.ts:530` `revalidateLocalizedPaths('/', '/admin/dashboard', topic)`.
- A 500-photo LR publish queue triggers 500 whole-app revalidations. TODAY this is
  near-free: public routes run `revalidate = 0` (CLAUDE.md "Public route freshness"), so
  there is no ISR cache to bust. It becomes a real cost only if ISR returns.
- **Disposition:** defer with exit criterion (see plan); not worth code churn while
  revalidate=0 stands.

### DOC-R4C1-08 — Lint-gate documentation drift (CLAUDE.md + AGENTS.md)
- **Severity/Confidence: LOW / High** (confirmed)
- **Where:** `CLAUDE.md:456-458` ("Three lint scripts enforce architectural invariants…"
  — lists api-auth, action-origin, eslint) and `AGENTS.md` "Quality gates (all blocking)".
- `package.json` ships a FOURTH blocking gate: `lint:public-route-rate-limit`
  (`scripts/check-public-route-rate-limit.ts`, security-critical header, cycle-3 D-101-15)
  and the orchestrator's GATES list includes it. Both canonical docs omit it — a future
  contributor adding a public mutating route won't know the gate exists or how to exempt
  (`@public-no-rate-limit-required: <reason>`).
- **Fix:** document the fourth gate in both files (count + behavior + exemption tag +
  GET-not-scanned caveat).

### CHORE-R4C1-09 — Committed stray Playwright artifact at repo root
- **Severity/Confidence: LOW / High** (confirmed)
- **Where:** repo root file literally named `--viewport=1440x900` (3.4 KB PNG,
  tracked — `git ls-files` matches).
- A CLI flag once parsed as an output filename and got committed. It pollutes the repo
  root, breaks naive `ls | xargs`-style tooling (leading `--`), and serves no purpose.
- **Fix:** `git rm -- './--viewport=1440x900'` in a chore commit.

## Designer pass (no new findings)
- New tokens admin UI (`tokens-client.tsx`): all interactive elements ≥ 44 px
  (`min-h-[44px]` / `h-11 w-11`), aria-labels on icon buttons including per-row revoke
  with label interpolation, dialogs are Radix (focus-trapped, ESC), one-time plaintext
  pattern with `select-all` + copy affordance and failure toast. Empty/loading states
  present. i18n keys exist in both locales (812/812 parity verified).
- Touch-target audit remains a blocking unit test; passes at baseline.
- Note: the live-browser pass was skipped this cycle — the two failing unit gates take
  priority, and prior designer rounds (r9-r28 + per-cycle RPF designer files) hold for the
  unchanged public surface. The bidi-label spoof risk on the tokens list is tracked as
  SEC-R4C1-01 (renders fixed by sanitization, not UI change).

## Document-specialist verified-clean
- IMAGE_PIPELINE_VERSION=7 consistent (gallery-config-shared, CLAUDE.md, sw build).
- ETag formula, avif_effort=6 default, advisory-lock name list, backfill sidecar pattern,
  Node 24 / Next 16 / TS 6 claims — all consistent with code.
- `plan/` tracked in git (plans are committed); `.context/plans/` gitignored as documented.
