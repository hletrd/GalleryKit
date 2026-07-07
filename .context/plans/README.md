# Implementation Plans Index

This index is a convenience pointer for agents. The authoritative state for a cycle remains the individual plan and deferred files in this directory plus the latest review aggregate.

## Authoritative timeline

The single authoritative release lineage is the committed `origin/master` history. Cycle numbering
restarted at run-10 cycle 1 on 2026-07-06 from HEAD `657eb024` (the terminal commit of the 2026-07-01
recovery run, whose cycles 85-99 ran from a non-NFS checkout after the NFS worktree failed mid-cycle-85).
Cycle 99 of that run recorded review evidence but was never planned; its findings are folded into
run-10 cycle 1 (see `cycle-1-2026-07-06-plan.md` WP1/WP14). Do not derive frontier state from prose in
this file alone — verify against `git log` and the newest plan/deferred pair.

## Carry-forward age budget (adopted run-10 cycle 1)

A deferred High-severity finding that crosses 8 cycles unchanged must either be scheduled or be
explicitly reclassified as permanently-deferred/won't-fix with a documented product decision — it may
not be re-listed verbatim again. First application: `C77-ARCH-01` (restore mutation fence) is scheduled
in run-10 cycle 1 after 8+ cycles of carry-forward; `C94-11` (`COUNT(*) OVER()` first-page cost) is
re-opened on two-lane review agreement.

MED-severity checkpoint (added run-10 cycle 4, C4-45): a deferred Medium-severity finding that crosses
**16 cycles** unchanged must carry an explicit re-justification (why the exit criterion still has not
fired) or be reclassified — closing the previously no-teeth gap for the long MED tail without forcing a
premature product decision. This is a softer, longer-window sibling of the 8-cycle High rule; it makes
the MED backlog re-review mechanical rather than open-ended, but does not by itself force scheduling.

## Consolidated carry-forward register

- `deferred-carry-forward.md` (adopted run-10 cycle-3, C3-27) — one row per OPEN deferred
  finding across all registers with first-deferred cycle + age, making the 8-cycle age
  budget mechanically checkable. Per-cycle registers remain the authoritative detail records.

## Active Current-Cycle Plans

- Run-10 Cycle 4/100 Implementation Plan - 12-lane review from start HEAD `ec433dc4` (47 deduped findings, C4-01..C4-47); schedules 13 work packages incl. the migrate.js DML-baseline guard on every path, single-writer-guard self-healing re-acquire, gallery-config detached-accessor write-invalidation + honest rename, SW LRU phantom-entry accounting + respondWith de-gating, photo-viewer hydration determinism, shared-group shallow URL sync + prefetch=false, embedding-cursor model-version reset, image-zoom non-passive touchmove, and small-fix/docs/ledger batches (`cycle-4-2026-07-07-plan.md`)
- Run-10 Cycle 4/100 Deferred Findings - defers the upload-contract reader/writer split, LR blob retention window, inert-nginx-limiter verification, image-queue god-object partition, maintenance-scheduler extraction (scheduled-next), component-behavior test harness, per-photo OG self-fetch transport, admin full-res preview thumbnailing, SW opaque/CDN caching, durable embedding cursor, and the fd-realpath serve hardening, each with exit criteria (`cycle-4-2026-07-07-deferred.md`)

## Recent Plans

- Run-10 Cycle 3/100 Implementation Plan - COMPLETED + deployed (post-deploy verification `ec433dc4`): 12-lane review from start HEAD `e08b6f97` (38 deduped findings); shipped 16 work packages incl. the migrate.js mixed-case batch-swallow fix (4-lane agreement, empirically reproduced), single-writer-guard keepalive + DB-scoped lock, detached backfill uncached-config, 404 robots-conflict fix, SW touchMeta durability, swipe-visual reset, embedding-scan cursor persistence, nginx nextimage zone + apply runbook, and test/docs batches (`cycle-3-2026-07-07-plan.md`)
- Run-10 Cycle 3/100 Deferred Findings - defers the i18n client-payload trim, CSP memoization (conflicts with pinned fail-degrade semantics), tag lock-order, JSON-LD dev-warning validation, migrate-journal redesign, data.ts split, and the two operator halves (nginx apply, LB realip), each with exit criteria (`cycle-3-2026-07-07-deferred.md`)
- Run-10 Cycle 2/100 Implementation Plan - COMPLETED + deployed (post-deploy verification `e08b6f97`): 12-lane fresh review from start HEAD `642c5091`; mandatory carry-over fixed first (deploy-host container build, `223b3836`); shipped 26 work packages incl. Lightbox/Info-sheet focus restore, soft-404 status fix, byte-impacting-settings re-encode notice, single-writer boot guard, ISOBMFF parent-bound validation, SW 304 write-amplification fix, lean topics accessor, and a perf/test/docs batch (`cycle-2-2026-07-07-plan.md`)
- Run-10 Cycle 2/100 Deferred Findings - defers map clustering, embedding-matrix cache, view-record round-trip fold, on-this-day index/migration, GPS-strip streaming, `updated_at` index migration, site-config runtime-mount decision, storage-module product decision, restore-drain slot re-scoping, scanner tokenizer rework, and the perf long-tail, each with exit criteria (`cycle-2-2026-07-07-deferred.md`)

- Run-10 Cycle 1/100 Implementation Plan - COMPLETED: 16 commits pushed (terminal `642c5091`), all 8 gates green locally, retroactively verify-arch-approved; the per-cycle deploy failed on the container build (drizzle-kit TS2307) and was carried over as run-10 cycle-2's mandatory first work item, fixed as `223b3836` (`cycle-1-2026-07-06-plan.md`)
- Run-10 Cycle 1/100 Deferred Findings - defers mysql2-internals coupling test, broad source-contract retirement (policy adopted instead), multipart RSS measurement, startup TRUST_PROXY fail-loud, Collections admin UI product decision, and operator topology confirmation, each with exit criteria (`cycle-1-2026-07-06-deferred.md`)
- Cycle 98/100 Implementation Plan - committed/pushed as signed `d6912560`; closed public select allowlist coverage, raw i18n duplicate-key detection, and Cycle 97 release-ledger evidence (`cycle-98-2026-07-01-plan.md`)
- Cycle 98/100 Deferred Findings - no newly deferred findings; carry-forward broad items remain preserved in Cycle 96 deferred register (`cycle-98-2026-07-01-deferred.md`)
- Cycle 99 (recovery run, partial) - review-only: architect + perf lanes committed as `8b09ce64`/`657eb024`; never planned in that run; findings folded into Run-10 Cycle 1 (`.context/reviews/cycle-99-2026-07-01/`)
- Cycle 97/100 Implementation Plan - committed/pushed/deployed as signed `6f40f66d`; feed maintenance/rate limiting, restore SQL scan-tail hardening, derivative cleanup, grid P3 badge visibility, upload accept source-contract parity (`cycle-97-2026-07-01-plan.md`)
- Cycle 97/100 Deferred Findings - no newly deferred findings; carry-forward broad items remain preserved in Cycle 96 deferred register (`cycle-97-2026-07-01-deferred.md`)
- Cycle 96/100 Implementation Plan - committed/pushed/deployed as `061c1c81`; closed safe narrow token list, Unicode label, privacy map disclosure, upload accept, and release ledger findings (`cycle-96-2026-07-01-plan.md`)
- Cycle 96/100 Deferred Findings - broad restore/schema/query/UI/test/runbook findings preserved with original severity/confidence and exit criteria; `C77-ARCH-01` and `C94-11` left this register for the Run-10 Cycle 1 schedule (`cycle-96-2026-07-01-deferred.md`)
- Cycle 95/100 Implementation Plan - committed/pushed/deployed as `21780465`; closed safe narrow release-ledger evidence for Cycle 94 (`cycle-95-2026-07-01-plan.md`)
- Cycle 95/100 Deferred Findings - no newly deferred findings, carry-forward broad route-level upload coverage, admin E2E, zoom keyboard panning, mobile admin redesign, restore/schema/performance findings preserved with exit criteria (`cycle-95-2026-07-01-deferred.md`)

- Cycle 97/100 Implementation Plan - committed/pushed/deployed as signed `6f40f66d9a6949ea866966230e5fe0ba61024637`; Cycle 98 started from user-provided deployed `master` HEAD `6f40f66d9a6949ea866966230e5fe0ba61024637` (`cycle-97-2026-07-01-plan.md`)
- Cycle 96/100 Implementation Plan - signed commit `061c1c81af234469641f75a53e5bbc61fa63114a` is the user-provided deployed `master` HEAD at Cycle 97 start (`cycle-96-2026-07-01-plan.md`)
- Cycle 95/100 Implementation Plan - final docs-only release ledger sync committed/pushed at `2f22620c361304ba0408053f546f45e3c74ddfdb`; Cycle 96 started from user-provided deployed `master` HEAD `2f22620c361304ba0408053f546f45e3c74ddfdb` (`cycle-95-2026-07-01-plan.md`)
- Cycle 94/100 Implementation Plan - committed/pushed/deployed as `750729ada2403c0c01267670b9552a05e0ead217`; Cycle 95 started from user-provided deployed `master` HEAD `750729ada2403c0c01267670b9552a05e0ead217` and pre-change production smoke was healthy (`cycle-94-2026-07-01-plan.md`)
- Cycle 94/100 Deferred Findings - broad route-level upload coverage, admin E2E, zoom keyboard panning, mobile admin redesign, restore/schema/performance findings preserved with exit criteria (`cycle-94-2026-07-01-deferred.md`)
- Cycle 93/100 Implementation Plan - committed/pushed/deployed as `33eca7b5`; Cycle 94 started from user-provided deployed `master` HEAD `33eca7b5e4102bd5097777dbb926ee2cb94c6d71` (`cycle-93-2026-07-01-plan.md`)
- Cycle 93/100 Deferred Findings - broad restore/schema/E2E/sitemap/coverage/UI redesign findings preserved with exit criteria (`cycle-93-2026-07-01-deferred.md`)
- Cycle 92/100 Implementation Plan - committed/pushed/deployed as `2571d8a8`; Cycle 93 started from user-provided deployed `master` HEAD `2571d8a8c27e2d2a7bc95ed5e6a72e26487093dc` (`cycle-92-2026-07-01-plan.md`)
- Cycle 92/100 Deferred Findings - broad restore/schema/performance/E2E/UI/operational findings preserved with exit criteria (`cycle-92-2026-07-01-deferred.md`)
- Cycle 91/100 Implementation Plan - committed/pushed/deployed as signed `aacccbc`; fixed terminal-ledger and lightbox accessibility source-contract coverage from deployed `c648634` (`cycle-91-2026-07-01-plan.md`)
- Cycle 91/100 Deferred Findings - no newly deferred findings; broad carry-forward items remain bound to their recorded exit criteria (`cycle-91-2026-07-01-deferred.md`)
- Cycle 90/100 Implementation Plan - release-ledger closure committed/pushed/deployed as signed `dcc8055`, with docs-only terminal-evidence sync committed as `c648634`; Cycle 91 started from deployed `c648634` (`cycle-90-2026-07-01-plan.md`)
- Cycle 90/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-90-2026-07-01-deferred.md`)
- Cycle 89/100 Implementation Plan - implementation committed/pushed/deployed as `baefb42`; Cycle 90 started from deployed `baefb42` (`cycle-89-2026-07-01-plan.md`)
- Cycle 89/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-89-2026-07-01-deferred.md`)
- Cycle 88/100 Implementation Plan - implementation committed/pushed/deployed as `10cd166`; Cycle 89 started from deployed `10cd166` (`cycle-88-2026-07-01-plan.md`)
- Cycle 88/100 Deferred Findings - defers semantic embedding model-version storage migration; carry-forward register remains referenced (`cycle-88-2026-07-01-deferred.md`)
- Cycle 87/100 Implementation Plan - implementation committed/pushed/deployed as `afc2bf5`; Cycle 88 started from deployed `afc2bf5` (`cycle-87-2026-07-01-plan.md`)
- Cycle 87/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-87-2026-07-01-deferred.md`)
- Cycle 86/100 Implementation Plan - implementation committed/pushed/deployed as `ee83c13`; Cycle 87 started from deployed `ee83c13` (`cycle-86-2026-07-01-plan.md`)
- Cycle 86/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-86-2026-07-01-deferred.md`)
- Cycle 85/100 Implementation Plan - implementation committed/pushed/deployed as `0ba77ff`; Cycle 86 started from deployed `0ba77ff` (`cycle-85-2026-07-01-plan.md`)
- Cycle 85/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-85-2026-07-01-deferred.md`)
- Cycle 84/100 Implementation Plan - implementation committed/pushed/deployed as `1d29b988`; Cycle 85 started from deployed `1d29b988` (`cycle-84-2026-07-01-plan.md`)
- Cycle 84/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-84-2026-07-01-deferred.md`)
- Cycle 83/100 Implementation Plan - implementation committed/pushed as signed `023ae28d`; no committed Cycle 83 deploy transcript was present during Cycle 84 review, so Cycle 84 deploy is scheduled to supersede production state after its pushed fix (`cycle-83-2026-07-01-plan.md`)
- Cycle 83/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-83-2026-07-01-deferred.md`)
- Cycle 82/100 Implementation Plan - implementation committed/pushed/deployed as `cc46b1d6`; Cycle 83 started from deployed `cc46b1d6` (`cycle-82-2026-07-01-plan.md`)
- Cycle 82/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-82-2026-07-01-deferred.md`)
- Cycle 81/100 Implementation Plan - implementation committed/pushed/deployed as `c272c521`; Cycle 82 started from deployed `c272c521` (`cycle-81-2026-07-01-plan.md`)
- Cycle 81/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-81-2026-07-01-deferred.md`)
- Cycle 80/100 Implementation Plan - implementation committed/pushed as `4733d475`; no committed Cycle 80 deploy transcript was found during Cycle 81 review, so Cycle 81 deploy supersedes production state after its pushed fix (`cycle-80-2026-07-01-plan.md`)
- Cycle 80/100 Deferred Findings - defers the site-config runtime/build-time contract decision with an exit criterion; carry-forward register remains referenced (`cycle-80-2026-07-01-deferred.md`)
- Cycle 79/100 Implementation Plan - implementation committed/pushed/deployed as `8c4999c9`; Cycle 80 started from deployed `8c4999c9` (`cycle-79-2026-07-01-plan.md`)
- Cycle 79/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-79-2026-07-01-deferred.md`)
- Cycle 78/100 Implementation Plan - implementation committed/pushed/deployed as `9cc143d0`; Cycle 79 started from deployed `9cc143d0` (`cycle-78-2026-07-01-plan.md`)
- Cycle 78/100 Deferred Findings - no new deferred findings; carry-forward register remains referenced (`cycle-78-2026-07-01-deferred.md`)
- Cycle 77/100 Implementation Plan - implementation committed/pushed as `9286bef1`; no committed Cycle 77 deploy transcript was present at Cycle 78 review time, so Cycle 78 deploy supersedes production state after its pushed fix (`cycle-77-2026-07-01-plan.md`)
- Cycle 77/100 Deferred Findings - defers the cross-action restore foreground mutation barrier with a dedicated exit criterion; carry-forward register remains referenced (`cycle-77-2026-07-01-deferred.md`)
- Cycle 76/100 Implementation Plan - implementation committed/pushed/deployed; Cycle 77 started from deployed `8aefc365` (`cycle-76-2026-07-01-plan.md`)
- Cycle 76/100 Deferred Findings - defers low-risk behavior-test hardening items; carry-forward register remains referenced (`cycle-76-2026-07-01-deferred.md`)
- Cycle 75/100 Implementation Plan - implementation committed/pushed/deployed; Cycle 76 started from deployed `a295ae44` (`cycle-75-2026-07-01-plan.md`)
- Cycle 75/100 Deferred Findings - bulk-edit validation field association deferred; carry-forward register remains referenced (`cycle-75-2026-07-01-deferred.md`)
- Cycle 74/100 Implementation Plan - implementation committed/pushed/deployed; Cycle 75 started from deployed `29f4176d` (`cycle-74-2026-07-01-plan.md`)
- Cycle 74/100 Deferred Findings - no new deferred findings; Cycle 73 deferred behavior-coverage items and carry-forward register remain referenced (`cycle-74-2026-07-01-deferred.md`)
- Cycle 73/100 Implementation Plan - implementation committed/pushed/deployed; Cycle 74 started from deployed `92924220` (`cycle-73-2026-07-01-plan.md`)
- Cycle 73/100 Deferred Findings - sidecar write-boundary behavior test and Settings UI persistence smoke deferred with exit criteria; carry-forward items repeated (`cycle-73-2026-07-01-deferred.md`)
- Cycle 72/100 Implementation Plan - implementation committed/pushed/deployed; Cycle 73 started from deployed `96459b7a` (`cycle-72-2026-07-01-plan.md`)
- Cycle 72/100 Deferred Findings - feed conditional route tests superseded by scheduled Cycle 73 coverage; browser-matrix smokes and carry-forward items repeated (`cycle-72-2026-07-01-deferred.md`)
- Cycle 71/100 Implementation Plan - implementation committed/pushed/deployed; Cycle 72 started from deployed `363dc1c9` (`cycle-71-2026-07-01-plan.md`)
- Cycle 71/100 Deferred Findings - no new deferred findings; carry-forward items repeated (`cycle-71-2026-07-01-deferred.md`)
- Cycle 70/100 Implementation Plan - implementation committed/pushed/deployed; Cycle 71 started from deployed `bf86f7c1` (`cycle-70-2026-07-01-plan.md`)
- Cycle 70/100 Deferred Findings - no new deferred findings; carry-forward items repeated (`cycle-70-2026-07-01-deferred.md`)
- Cycle 69/100 Implementation Plan - implementation committed/pushed/deployed; Cycle 70 started from deployed `6e3e54e9` (`cycle-69-2026-07-01-plan.md`)
- Cycle 69/100 Deferred Findings - no new deferred findings; carry-forward items repeated (`cycle-69-2026-07-01-deferred.md`)
- Cycle 68/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 69 started from deployed `87e2b98d` (`cycle-68-2026-07-01-plan.md`)
- Cycle 68/100 Deferred Findings — no new deferred findings; carry-forward items repeated (`cycle-68-2026-07-01-deferred.md`)
- Cycle 67/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 68 started from deployed `e221b01a` (`cycle-67-2026-07-01-plan.md`)
- Cycle 67/100 Deferred Findings — no new deferred findings; carry-forward items repeated (`cycle-67-2026-07-01-deferred.md`)
- Cycle 66/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 67 started from deployed `3e8ab924` (`cycle-66-2026-07-01-plan.md`)
- Cycle 66/100 Deferred Findings — no new deferred findings; carry-forward items repeated (`cycle-66-2026-07-01-deferred.md`)
- Cycle 65/100 Implementation Plan — implementation committed/pushed/deployed; terminal evidence recorded in plan (`cycle-65-2026-07-01-plan.md`)
- Cycle 65/100 Deferred Findings — durable settings-only re-encode marker deferred; carry-forward items repeated (`cycle-65-2026-07-01-deferred.md`)
- Cycle 64/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 65 started from deployed `ad1bc983` (`cycle-64-2026-07-01-plan.md`)
- Cycle 64/100 Deferred Findings — no new deferred findings; carry-forward items repeated (`cycle-64-2026-07-01-deferred.md`)
- Cycle 63/100 Implementation Plan — implementation committed/pushed/deployed; deploy evidence recorded in plan (`cycle-63-2026-07-01-plan.md`)
- Cycle 63/100 Deferred Findings — no new deferred findings; `C62-04` superseded by scheduled `C63-01`; carry-forward items repeated (`cycle-63-2026-07-01-deferred.md`)
- Cycle 62/100 Implementation Plan — implementation committed/pushed/deployed; public search smoke passed after deploy (`cycle-62-2026-07-01-plan.md`)
- Cycle 62/100 Deferred Findings — search status announcement polish deferred; carry-forward items repeated (`cycle-62-2026-07-01-deferred.md`)
- Cycle 61/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 62 started from deployed `0bf3371c` (`cycle-61-2026-07-01-plan.md`)
- Cycle 61/100 Deferred Findings — broad test-coverage gaps deferred; carry-forward items repeated (`cycle-61-2026-07-01-deferred.md`)
- Cycle 60/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 61 started from deployed `7e85644e` (`cycle-60-2026-07-01-plan.md`)
- Cycle 60/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-60-2026-07-01-deferred.md`)
- Cycle 59/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 60 started from deployed `fe112ba5` (`cycle-59-2026-07-01-plan.md`)
- Cycle 59/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-59-2026-07-01-deferred.md`)
- Cycle 58/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 59 started from deployed `a4bb2670` (`cycle-58-2026-07-01-plan.md`)
- Cycle 58/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-58-2026-07-01-deferred.md`)
- Cycle 57/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 58 started from deployed `51bca789` (`cycle-57-2026-07-01-plan.md`)
- Cycle 57/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-57-2026-07-01-deferred.md`)
- Cycle 56/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 57 started from deployed `677a8410` (`cycle-56-2026-07-01-plan.md`)
- Cycle 56/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-56-2026-07-01-deferred.md`)
- Cycle 55/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 56 started from deployed `e82311b9` (`cycle-55-2026-07-01-plan.md`)
- Cycle 55/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-55-2026-07-01-deferred.md`)
- Cycle 54/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 55 started from deployed `4dbbbf9b` (`cycle-54-2026-07-01-plan.md`)
- Cycle 54/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-54-2026-07-01-deferred.md`)
- Cycle 53/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 54 started from deployed `1a65247c` (`cycle-53-2026-07-01-plan.md`)
- Cycle 53/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-53-2026-07-01-deferred.md`)
- Cycle 52/100 Implementation Plan — implementation committed/pushed; Cycle 53 started from deployed `17db8e38` (`cycle-52-2026-07-01-plan.md`)
- Cycle 52/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-52-2026-07-01-deferred.md`)
- Cycle 51/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 52 started from deployed `d7326789` (`cycle-51-2026-07-01-plan.md`)
- Cycle 51/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-51-2026-07-01-deferred.md`)
- Cycle 50/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 51 started from deployed `11c4337f` (`cycle-50-2026-07-01-plan.md`)
- Cycle 50/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-50-2026-07-01-deferred.md`)
- Cycle 49/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 50 started from deployed `3a02f7ee` (`cycle-49-2026-07-01-plan.md`)
- Cycle 49/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-49-2026-07-01-deferred.md`)
- Cycle 48/100 Implementation Plan — closed; Cycle 49 started from deployed `dc4f4acf` (`cycle-48-2026-07-01-plan.md`)
- Cycle 48/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-48-2026-07-01-deferred.md`)
- Cycle 47/100 Implementation Plan — implementation committed/pushed/deployed; deploy evidence recorded in plan (`cycle-47-2026-07-01-plan.md`)
- Cycle 47/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-47-2026-07-01-deferred.md`)
- Cycle 46/100 Implementation Plan — implementation committed/pushed/deployed; Cycle 47 invocation states `ab38f260` was the current deployed `master` HEAD at start (`cycle-46-2026-07-01-plan.md`)
- Cycle 46/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-46-2026-07-01-deferred.md`)
- Cycle 45/100 Implementation Plan — no source fixes scheduled; convergence docs committed/pushed/deployed; deploy evidence recorded in plan (`cycle-45-2026-07-01-plan.md`)
- Cycle 45/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-45-2026-07-01-deferred.md`)
- Cycle 44/100 Implementation Plan — implementation committed/pushed/deployed; deploy evidence recorded in plan (`cycle-44-2026-07-01-plan.md`)
- Cycle 44/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-44-2026-07-01-deferred.md`)
- Cycle 43/100 Implementation Plan — implementation source committed/pushed/deployed; Cycle 44 invocation states `f417d86b` was the current deployed `master` HEAD at start (`cycle-43-2026-07-01-plan.md`)
- Cycle 43/100 Deferred Findings — no new deferred items; carry-forward only (`cycle-43-2026-07-01-deferred.md`)
- Cycle 42/100 Implementation Plan — implementation source committed/pushed; committed deploy evidence not found (`cycle-42-2026-07-01-plan.md`)
- Cycle 42/100 Deferred Findings — deferred (`cycle-42-2026-07-01-deferred.md`)
- Cycle 41/100 Implementation Plan — implementation pushed; committed deploy evidence not found (`cycle-41-2026-07-01-plan.md`)
- Cycle 41/100 Deferred Findings — no new deferred items (`cycle-41-2026-07-01-deferred.md`)
- Cycle 40/100 Implementation Plan — implementation complete; push/deploy evidence in final report (`cycle-40-2026-07-01-plan.md`)
- Cycle 40/100 Deferred Findings — deferred (`cycle-40-2026-07-01-deferred.md`)
- Cycle 39/100 Implementation Plan — historical active marker retained; read matching final report before inferring state (`cycle-39-2026-06-30-plan.md`)
- Cycle 39/100 Deferred Findings — deferred (`cycle-39-2026-06-30-deferred.md`)
- Cycle 38/100 Implementation Plan — implementation complete; push/deploy evidence in final report (`cycle-38-2026-06-30-plan.md`)
- Cycle 38/100 Deferred Findings — deferred (`cycle-38-2026-06-30-deferred.md`)
- Cycle 37/100 Implementation Plan — implementation complete; push/deploy evidence in final report (`cycle-37-2026-06-30-plan.md`)
- Cycle 37/100 Deferred Findings — deferred (`cycle-37-2026-06-30-deferred.md`)
- Cycle 36/100 Implementation Plan — implementation complete; push/deploy evidence in final report (`cycle-36-2026-06-30-plan.md`)
- Cycle 36/100 Deferred Findings — deferred (`cycle-36-2026-06-30-deferred.md`)

- Cycle 35/100 Implementation Plan — implementation complete; push/deploy evidence in final report (`cycle-35-2026-06-30-plan.md`)
- Cycle 35/100 Deferred Findings — no new deferred items (`cycle-35-2026-06-30-deferred.md`)
- Cycle 34/100 Implementation Plan — done (`cycle-34-2026-06-30-plan.md`)
- Cycle 34/100 Deferred Findings — no new deferred items (`cycle-34-2026-06-30-deferred.md`)
- Cycle 33/100 Implementation Plan — done (`cycle-33-2026-06-30-plan.md`)
- Cycle 33/100 Deferred Findings — deferred (`cycle-33-2026-06-30-deferred.md`)
- Cycle 32/100 Implementation Plan — done (`cycle-32-2026-06-30-plan.md`)
- Cycle 32/100 Deferred Findings — deferred (`cycle-32-2026-06-30-deferred.md`)
- Cycle 31/100 Implementation Plan — done (`cycle-31-2026-06-30-plan.md`)
- Cycle 30/100 Implementation Plan — done (`cycle-30-2026-06-30-plan.md`)
- Cycle 30/100 Deferred Findings — deferred (`cycle-30-2026-06-30-deferred.md`)
- Cycle 29/100 Implementation Plan — done (`cycle-29-2026-06-30-plan.md`)
- Cycle 29/100 Deferred Findings — deferred (`cycle-29-2026-06-30-deferred.md`)
- Cycle 28/100 Implementation Plan — done (`cycle-28-2026-06-30-plan.md`)
- Cycle 28/100 Deferred Findings — deferred (`cycle-28-2026-06-30-deferred.md`)

## Archived / Historical Notes

- Older cycle files remain in this directory or in its archive/done subdirectories when present.
- Broken historical links to absent `.context/plan/plan-37x-*` files were removed in cycle 33; use `find .context/plans -maxdepth 2 -type f` for the actual committed inventory.
- Do not infer unresolved implementation work from this README alone. Read the newest `cycle-*-plan.md`, matching deferred file, and `.context/reviews/_aggregate.md`.
