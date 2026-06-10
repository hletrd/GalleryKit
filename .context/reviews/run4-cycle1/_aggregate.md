# Aggregate review — Run-4 Cycle 1

Per-angle provenance files in this directory:
- `security-reviewer.md` (security + critic + verifier)
- `code-reviewer-debugger-tracer.md` (code-reviewer + debugger + tracer)
- `test-engineer.md` (test-engineer + verifier on gates)
- `perf-architect-docs-designer.md` (perf-reviewer + architect + document-specialist + designer)

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested Agent/Task
spawning is unavailable in this context (same constraint as run2/run3 cycles — see
`run3-cycle5/_aggregate.md`). Each angle was executed as a distinct full-inventory pass
in-context; no angle sampled. Inventory: 14 action files, 10 API routes, 83 lib files,
54 components, 25 scripts, 6 e2e specs, schema, SW template, docs (CLAUDE.md/AGENTS.md),
messages (EN/KO).

## Context
Run-3 converged at cycle 5 with zero findings after the LR-PAT-divergence cluster closed
(HEAD ad64cff6 lineage). This cycle's fresh pass focused on (1) the youngest code (LR PAT
route + token surfaces shipped in US-P53/run-3), (2) a clean-tree gate baseline, (3)
doc-vs-code drift. The gate baseline immediately surfaced 2 failing unit tests — both
root-caused (one flaky test, one heavyweight-import product smell).

## Cross-angle agreement
- The LR PAT route insert-tail gap (no catch → orphan + quota leak) was independently
  flagged by the security angle (disk-fill + quota starvation) and the code/tracer angle
  (TOCTOU FK + safeInsertId throw): **highest-signal finding this cycle**.
- The serve-upload heavy import was independently flagged by perf (cold-start) and
  test-engineer (gate timeout): same root cause, one fix.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| TEST-R4C1-06 | HIGH(gate)/High | Flaky backfill detection-failure test: fixed setImmediate drain races real sharp I/O | test-engineer, tracer |
| TEST/PERF-R4C1-07 | HIGH(gate)+MED/High | `serve-upload.ts:7` imports IMAGE_PIPELINE_VERSION from heavy `process-image` instead of `gallery-config-shared` → 15 s first-import timeout + sharp on serving path | test-engineer, perf, code-reviewer |
| SEC-R4C1-01 | MED/High | PAT token `label` bypasses `sanitizeAdminString` policy (bidi/zero-width/C0 on credential-management UI + audit metadata); plus Invalid-Date `expiresAt` → never-expiring token; raw `err.message` to client | security |
| COR-R4C1-02 | MED/High | LR upload: unhandled insert/enqueue failure → orphaned original + leaked tracker quota + opaque 500 (browser path handles) | security, code-reviewer, debugger |
| COR-R4C1-03 | LOW-MED/High | LR upload `user_filename` lacks `getSafeUserFilename` parity (basename/control-chars/empty/byte-budget/surrogate split); raw name in audit metadata | security, code-reviewer |
| COR-R4C1-04 | LOW-MED/High | LR upload title/description UTF-16 `.slice` diverges from canonical `countCodePoints` validation (mojibake via U+FFFD) | code-reviewer |
| COR-R4C1-05 | LOW-MED/High | LR upload enqueue omits `camera_model`/`capture_date` → degraded auto alt-text on LR ingest | code-reviewer, tracer |
| DOC-R4C1-08 | LOW/High | CLAUDE.md "Three lint scripts" + AGENTS.md quality-gates omit 4th blocking gate `lint:public-route-rate-limit` | document-specialist |
| CHORE-R4C1-09 | LOW/High | Committed stray Playwright PNG named `--viewport=1440x900` at repo root | architect |
| ARCH-R4C1-11 | LOW/Medium | LR route `revalidateAllAppData()` per single-file publish (no-op cost while public `revalidate=0`; matters only if ISR returns) | architect |
| COR-R4C1-12 | HIGH/High | `scripts/migrate.js` fresh-DB bootstrap fails on FIRST run: empty DB skips the reconcile path (`prepareLegacyDatabaseIfNeeded` early-return) and drizzle's MAX(created_at) cursor + non-monotonic journal whens (entries 7-17) silently skip migrations, dying on a later entry's SQL; a second run accidentally heals via the legacy path. Every fresh install / e2e cold DB affected. Discovered live during this cycle's e2e gate (init failed on the cold container, succeeded on rerun) | debugger/tracer (gate work) |
| COR-R4C1-13 | HIGH/High | `reconcileLegacySchema` drifted from the schema: the color/HDR-era columns (migrations 0015-0018 — `color_pipeline_decision`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `pipeline_version`) were never mirrored, violating the runbook's step-3 contract. Every DB bootstrapped through the reconcile path came out missing all seven columns; the first `images` INSERT fails with ER_BAD_FIELD_ERROR. Verified fixed by fresh-container init + authoritative drizzle-vs-information_schema diff (CLEAN); locked by new `__tests__/migrate-reconcile-coverage.test.ts` tripwire | debugger/tracer (gate work) |
| UX-R4C1-14 | HIGH/High | Mouse clicks on the photo viewer's Prev/Next buttons are swallowed by the photo image: commit fc3d0ad8 (R10-M11 blur crossfade) added `z-10` to the AnimatePresence image wrapper, a LATER sibling of the z-10 nav-button containers in `photo-viewer.tsx:712-751` — equal z-index + later DOM order paints the full-bleed image box over the buttons (`photo-navigation.tsx:210/225`). Keyboard nav and swipe still worked, masking it; the shared-group e2e click test failed deterministically (twice) with "img … subtree intercepts pointer events". Fix: nav containers to z-20 (matching the swipe indicators) | designer/debugger (gate work) |

All HIGH/MED items are scheduled for this cycle's plan; ARCH-R4C1-11 is the sole deferral
candidate (explicit entry with exit criterion in the plan).

## Gate baseline (clean tree)
- eslint: PASS · lint:api-auth: PASS · lint:action-origin: PASS ·
  lint:public-route-rate-limit: PASS
- vitest: **FAIL — 2 failed / 1501 passed** (TEST-R4C1-06, TEST/PERF-R4C1-07)
- typecheck / build / e2e: run during PROMPT 3 after fixes (build embeds typecheck).

## HARD-SCOPE check
No finding proposes edit/culling/scoring/preset/tone-authoring features. Nothing dropped.

## AGENT FAILURES
None. Nested-agent spawning unavailable in the subagent context (documented constraint,
same as run2/run3); all angles executed in-context with full inventory and per-angle
provenance files above.
