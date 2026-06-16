# Plan 355 — Run 6 / Cycle 4 — Deferred Findings

**Source:** `.context/reviews/_aggregate.md` (cycle 4, HEAD f8147868) + 11 per-agent reviews.
**Status:** DEFERRED REGISTER (no implementation this cycle).

Per the review-plan-fix deferred-fix rules: every review finding NOT scheduled in `plan-354` is recorded as deferred with file+line citation, **original** severity/confidence (NOT downgraded to justify deferral), concrete deferral reason, and the exit criterion that re-opens it.

---

## NO NEW DEFERRALS THIS CYCLE

All five NEW findings surfaced in cycle 4 (AGG-C4-01 through AGG-C4-05) are **scheduled for implementation** in `plan-354-run6-cycle4-fixes.md`. Nothing new was dropped or deferred.

---

## CARRIED FORWARD UNCHANGED FROM `plan-353-run6-cycle3-deferred.md`

The prior-cycle deferred register (`plan-353`) holds findings AGG-C3-08 through AGG-C3-33. During cycle 4, the relevant specialist agents **re-validated each at HEAD f8147868 and confirmed the deferral reasoning is still factually correct** (anchors present, behavior unchanged, repo-rule basis intact). They are therefore carried forward unchanged under their existing exit criteria. The authoritative record for each — citation, original severity/confidence, quoted repo-rule basis where applicable, and exit criterion — remains `plan-353`; this section is the cycle-4 re-confirmation index, not a re-statement.

| ID | Severity | Re-confirming agent(s) this cycle | Repo-rule basis (where applicable) |
|---|---|---|---|
| AGG-C3-08 — orphaned `original/{uuid}` on SIGKILL | LOW | tracer, debugger | Disk-bloat only; not correctness/data-loss |
| AGG-C3-09 — upload-tracker quota not released in outer `finally` | LOW | debugger | Framework-only trigger; admin self-impact |
| AGG-C3-10 — sRGB metadata-decode discard (`process-image.ts:1019-1022`) | LOW-MED | perf-reviewer | Perf-only; code self-documents the tradeoff |
| AGG-C3-11 — admin OFFSET pagination (`data.ts:915-937`) | LOW | perf-reviewer | Admin-only, page-clamped to 1000 |
| AGG-C3-12 — SW per-tile HEAD ETag probe (`sw.js:233-257`) | LOW | perf-reviewer | Deliberate color-freshness tradeoff, 300ms bound |
| AGG-C3-13 — misc perf LOWs (filesort/unindexed/correlated/re-render) | LOW | perf-reviewer | Micro-opts on admin/low-freq surfaces |
| AGG-C3-14 — `@/lib/storage` dead weight | HIGH (structural) | architect | CLAUDE.md: retained future abstraction, do not expose until wired |
| AGG-C3-15 — restore-maintenance flag process-local | HIGH (architect) / Med (critic refuted corruption) | architect | CLAUDE.md: single-instance / single-writer topology |
| AGG-C3-16 — `reconcileLegacySchema` hand-maintained mirror | MEDIUM | architect | Robust + fail-loud on journal hash; residual is net-new test infra |
| AGG-C3-17 — `actions/images.ts` god-action + LR route dup | MEDIUM | architect | High-blast-radius refactor; both copies correct, unchanged since baseline |
| AGG-C3-19 — processing-claim race has no runtime test | MEDIUM | test-engineer | Net-new two-worker race harness; invariant currently sound |
| AGG-C3-20 — untested admin-mutation actions | MEDIUM | test-engineer | Coverage gap, not a defect; guards lint-enforced |
| AGG-C3-21 — `analytics-data.ts` no tests | LOW | test-engineer | Coverage gap; admin-only, currently working |
| AGG-C3-22 — `data-tag-names-sql.test.ts` rebuilds query inline | LOW | test-engineer | Source-shape scans cover the gap; contract green |
| AGG-C3-23 — e2e gaps (paid-download/license/view-count/webhook) | LOW | test-engineer | Underlying behaviors unit-tested; Stripe op-closed |
| AGG-C3-24 — timeline/year cards no touch title | LOW | designer | Minor discoverability; alt/aria still present |
| AGG-C3-25 — lightbox spinner silent `role=status` | LOW | designer | Transient SR gap |
| AGG-C3-26 — histogram compute overlay no live region | LOW | designer | Transient SR gap; bundle with C3-25 |
| AGG-C3-27 — hardcoded `outline-blue-500` (now 3 spots, was 4) | LOW | designer | Token-consistency cleanup; rings still visible. NOTE: scope shrank — `:189` already migrated to `ring-white/50` (net-positive drift) |
| AGG-C3-28 — InfoBottomSheet empty peek pill on sRGB | LOW | designer | Cosmetic empty-state nit |
| AGG-C3-29 — TopicManager dialogs lack `DialogDescription` | LOW | designer | Radix warning; dialogs have titles + labeled fields |
| AGG-C3-30 — `ui/sheet.tsx` unused, sub-44px close button | INFO | designer | Dead code; no runtime impact |
| AGG-C3-31 — git-history SESSION_SECRET + bootstrap passwords | MEDIUM (operational) | security-reviewer | OPERATIONAL, HEAD clean; CLAUDE.md documents rotate-immediately; history rewrite needs explicit operator confirmation (Destructive Action Safety) |
| AGG-C3-32 — SQL-restore scanner inter-token comment bypass | LOW | security-reviewer | Defense-in-depth only; behind isAdmin + same-origin + `--one-database`; app-table drops intentionally allowed |
| AGG-C3-33 — admin-token `last_used_at` bumped before scope check | LOW | security-reviewer | Cosmetic ordering; request still rejected |

**Repo-rule basis for the structural/security deferrals (unchanged from plan-353):** CLAUDE.md documents the single-writer / single-instance topology as an explicit design constraint and explicitly retains `@/lib/storage` as an un-wired future abstraction. None of the deferred items is a security, correctness, or data-loss defect that the repo's rules forbid deferring; the two security-tagged items (AGG-C3-31 operational secret-rotation, AGG-C3-32 defense-in-depth scanner) are explicitly defense-in-depth/operational, not exploitable code defects at HEAD (security-reviewer rated overall risk LOW, 0 Critical/0 High again this cycle). The full quoted-rule justification for each lives in `plan-353`.

**Exit criteria:** unchanged — see the corresponding entry in `plan-353-run6-cycle3-deferred.md`.

---

## CLOSED — verified at HEAD, NOT deferred and NOT re-planned

Re-verified closed at HEAD f8147868 by the cycle-4 fan-out (recorded to prevent future re-reporting):
- All 8 cycle-3 scheduled fixes (`06a3c5e7..0ef29a10`): TOPIC_RESOURCES_ROOT test isolation, Switch geometry, histogram contrast, backfill exit code, settings-hash max-age docstring, serve-upload ETag de-enumeration, Stripe cross-ref label, color-detection re-export removal.
- settings-hash covers **9** `COLOR_IMPACTING_KEYS`; `cache()` wraps **10** data-access functions (both re-confirmed by document-specialist).
- AGG-C3-18 re-export trap CLOSED **and regression-pinned** by `wide-gamut-predicate-wiring.test.ts` (architect).
- All ~58 prior-cycle findings (OG SSRF pin, Stripe card-only guard, bidi/zero-width stripping, SW LRU head-walk, map LIMIT, serve-upload FD leak, CLIP embedding round-trip, analytics retention sweep, config re-darkening, build externalization, blur-data-url producer wrap, a11y batch).

**HARD GUARD:** CLIP semantic search remains disabled-by-design. No agent proposed activation; the disable/heal logic is verified correct (verifier: `gallery-config.ts:143-145`). Nothing in this register touches that.
