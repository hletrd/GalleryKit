# Run-10 Cycle 1/100 Aggregate Review

Start HEAD (post-reconciliation): `657eb0243f49898c0f902fda60669d63b17a512d` (== `origin/master`).
Date: 2026-07-06.
Review lanes: 12 (code-reviewer, fd-code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer). Per-agent provenance files live beside this aggregate.

## Cycle-start reconciliation (context for every finding below)

This worktree began the cycle 20 commits BEHIND origin (stale mid-cycle-85 snapshot with uncommitted
duplicate diffs, plus untracked partial cycle-94 review copies). A prior recovery run had completed
cycles 85–99 from a non-NFS checkout (`0ba77ff4`..`657eb024`). During this cycle's review fan-out the
worktree was fast-forwarded to `657eb024`; the superseded local diffs were preserved in
`git stash` (`run10-cycle1:` entries), never discarded. Four lanes (critic, security, test, verifier)
started before the fast-forward — their stale-baseline findings are re-dispositioned below with
evidence at the new HEAD.

## Deduplicated findings

| ID | Severity | Conf. | Sources (cross-agent agreement) | Summary | Disposition |
|----|----------|-------|--------------------------------|---------|-------------|
| C1-01 | Medium | High | fd-code-reviewer FD-01; cycle-99 architect (orphaned); critic CRIT-02-class; docs DOC-02 | `load_more`/`view_record` limiters do DB increment+select+decrement for requests already over the in-memory limit; `search` has the read-only saturated fast path | Scheduled |
| C1-02 | High | Medium | debugger DBG-03 | Backup writes straight to the canonical filename (no tmp+atomic-rename) and restore trusts `mysql` exit 0; clean-boundary truncated dumps back up/restore "successfully" | Scheduled |
| C1-03 | High | High | critic CRIT-09 (re-validation of deferred C77-ARCH-01, aged 8+ cycles) | Restore maintenance fences uploads/queue but not general admin writers; a mutation admitted pre-marker can write into the restored DB | Scheduled (aged deferral drained per age-budget policy) |
| C1-04 | Medium | High | tracer TRC-01 | Claim-exhaustion give-up never persists `processing_error`; row is silently re-enqueued forever; `RELEASE_LOCK` failure logged at debug though it can wedge a per-image lock | Scheduled |
| C1-05 | Medium | High | debugger DBG-01 | `cleanOrphanedTopicTempFiles` has no age gate (sibling cleanup is 60-min age-gated) and can delete an admin's in-flight topic-cover upload | Scheduled |
| C1-06 | Medium | High | perf-reviewer PERF-01 | `bootstrapMissingActiveEmbeddings` has no in-flight guard; overlapping scans duplicate CLIP work and starve the shared inference queue | Scheduled |
| C1-07 | Medium | High | critic CRIT-05 + perf-reviewer PERF-03 (independent validation); ledgered as deferred C94-11 | `COUNT(*) OVER()` on the hot first-page public listing forces full grouped materialization before `LIMIT`; lean `getImageCount` shape already exists in-repo | Scheduled (re-opened from deferral: 2-lane agreement + age budget) |
| C1-08 | Medium-High | High | designer DES-02 (live-verified) | Six admin/auth forms drop keyboard focus to `<body>` after every pending submission (`disabled={isPending}`) and never restore it | Scheduled |
| C1-09 | Medium | High | designer DES-01 (live-verified) | Timeline/Year month headings concatenate "January 20252 photos" for AT (CSS margin, no text separator); section accessible names garbled | Scheduled |
| C1-10 | Medium | High | designer DES-03 (live-verified) | Tokens page has zero headings; Users page starts at `<h2>`; both break the admin `<h1>` convention | Scheduled |
| C1-11 | Medium | Medium | security SEC-01 | nginx `default.conf` header comment claims "internal hop behind TLS-terminating LB" while every location OVERWRITES XFF with `$remote_addr` — in that topology all per-IP limits collapse to one bucket; contradicts CLAUDE.md's nginx-is-edge assumption | Scheduled (doc reconciliation; topology validation = operator item) |
| C1-12 | Low | High | security SEC-02 | Post-restore migrate child inherits full `process.env` incl. `SESSION_SECRET`; sibling dump/restore spawns use minimal env | Scheduled |
| C1-13 | Low | Medium | security SEC-03 | `TRUST_PROXY` unset behind a proxy degrades silently (single rate-limit bucket); fails safe but quiet | Docs scheduled; startup fail-loud deferred (hardening, fail-safe today) |
| C1-14 | Low-Medium | High | code-reviewer CR-01 | Topic OG ETag hashes content strings only — no template/pipeline version — so a card redesign never invalidates crawler caches (per-photo route has the guard) | Scheduled |
| C1-15 | Low | Medium | code-reviewer CR-02 | LR upload route: post-insert work (`revalidateAllAppData` etc.) can throw past `finally` → non-JSON 500 for an upload that committed; external client retries | Scheduled |
| C1-16 | Low | Medium | code-reviewer CR-03 | `/api/health` DB probe unbounded; a wedged (not refused) DB hangs the readiness endpoint and pins a pool connection | Scheduled |
| C1-17 | Low | High | code-reviewer CR-04 | similar-route comment claims "rollback on all early-return paths"; no rollback exists (behavior right, comment false contract) | Scheduled |
| C1-18 | Low | Medium | code-reviewer CR-05 | `updateTag` returns generic `failedToUpdateTag` on `ER_DUP_ENTRY`; sibling paths surface `tagSlugCollision` | Scheduled |
| C1-19 | Low | High | tracer TRC-02 | Delete-after-upload FK rejection of the un-awaited embedding insert logs a raw MySQL error at `warn` for expected behavior | Scheduled |
| C1-20 | Low | High | debugger DBG-02 | `processing_error` truncation uses UTF-16 `.slice(0,512)` (can bisect surrogate pairs); three sibling sites already use code-point-safe truncation | Scheduled |
| C1-21 | Low | High | perf-reviewer PERF-02 | Masonry stores raw `window.innerWidth` in state → every card re-renders per resize frame on long galleries | Scheduled |
| C1-22 | Low | High | test-engineer TEST-03 | `extractFnBody(source,'…deleteImage')` is a string-prefix of `'…deleteImages'`; `indexOf` match order is load-bearing (confirmed transferred to committed `image-queue-permanent-failure-cleanup.test.ts:110,118`) | Scheduled |
| C1-23 | Medium | High | test-engineer TEST-01 | `collections.ts` smart-collection mutations have zero behavior-level coverage | Scheduled |
| C1-24 | Low-Medium | High | test-engineer TEST-02 | `embeddings.ts` backfill action near-zero behavior coverage | Scheduled |
| C1-25 | High | High | document-specialist DOC-01 | CLAUDE.md documents `smart_collections` as admin-manageable; the CRUD actions are wired to NO UI/API surface (zero importers) — only the public read side exists | Scheduled (doc correction now; admin UI build = explicit product decision, deferred) |
| C1-26 | Medium | High | docs DOC-02 + critic CRIT-02/CRIT-06 + verifier VER-02 | Ledger integrity: committed cycle-99 review never aggregated/indexed/scheduled (same orphan pattern as cycle-94); three parallel cycle-numbering timelines; local-only cycle-85 per-agent provenance uncommitted | Scheduled (ledger repair + provenance commit) |
| C1-27 | Very Low | High | docs DOC-03 | CLAUDE.md "search for `ProPhoto`" pointer — file only contains lowercase `prophoto` | Scheduled |
| C1-28 | Very Low | High | verifier VER-01 | CLAUDE.md "secure (in production)" understates actual `requestIsHttps \|\| production` cookie logic | Scheduled |
| C1-29 | Low-Medium | High | architect ARCH-01 | Only value-level import cycle in 248 files: `photo-viewer.tsx` ⇄ `lightbox.tsx` (via `isEditableTarget`) — latent TDZ/undefined hazard | Scheduled |
| C1-30 | Low | High | architect ARCH-02 | `drizzle-kit` pinned to a git-hash snapshot prerelease (`1.0.0-beta.9-e89174b`) a major ahead of `drizzle-orm@^0.45`; `npm ci` wedges if the tarball is yanked | Scheduled (verify + repin), else deferred with exit criterion |
| C1-31 | Low | Medium | architect ARCH-03 | `db/index.ts` reaches into undocumented mysql2 wrapper internals to await per-connection `group_concat_max_len` init; silent truncation risk on mysql2 upgrade | Deferred (needs DB-integration test infra; exit criterion recorded) |
| C1-32 | Low-Medium | High | architect ARCH-04 + critic CRIT-04 (independent agreement) | 139/307 test files are source-shape contracts; same invariant often enforced 3×; taxes exactly the refactors that fix defects (e.g. C1-29) | Partially scheduled (policy + retire assertions touched by C1-07/C1-29); broader retirement deferred |
| C1-33 | Low | Medium | perf-reviewer PERF-04 | Multipart uploads are heap-materialized by the framework before disk streaming (~200 MB RSS per in-flight upload); needs measurement | Docs note scheduled; RSS measurement deferred |
| C1-34 | Medium | High | critic CRIT-03 + CRIT-08 | Loop-process: deferred Highs re-listed 8+ cycles with zero exit-criterion progress; convergence signal hides an undrained backlog | Scheduled (age-budget policy adopted; C77-ARCH-01 drained this cycle as C1-03) |

## Gate-discovered findings (added during PROMPT 3 implementation)

| ID | Severity | Conf. | Source | Summary | Disposition |
|----|----------|-------|--------|---------|-------------|
| C1-35 | High | High | e2e gate (this cycle) | `getImageByShareKey` used `SEPARATOR CHAR(1)` — an ER_PARSE_ERROR (SEPARATOR takes only a string literal), so EVERY `/s/[key]` shared-link photo render failed at HEAD; shipped by the recovery run, which never executed the e2e gate | Fixed (commit `4d02f695`) |
| C1-36 | Medium | High | e2e gate (this cycle) | `/g/[key]` renders `t('backToSharedPhotos')` from the `sharedGroup` namespace but the key existed only under `shared` — MISSING_MESSAGE on every shared-group photo view; invisible to key-parity tests (key absent from BOTH locales) | Fixed (commit `4d02f695`) |

Both pinned by `shared-link-runtime-contracts.test.ts`. Broader code→message key-reference validation is
recorded in the deferred register (exit criterion: an i18n usage-scan test or lint gate).

## Resolved during review (no plan entry needed beyond the record)

- **CRIT-01 (was Critical): local/origin divergence.** Resolved mid-cycle: `git fetch` + fast-forward to `657eb024`; local HEAD == origin/master, divergence 0/0. Superseded local diffs stash-preserved, verified equivalent-or-weaker than upstream `0ba77ff4` content before stashing.
- **CRIT-07: mixed-quality uncommitted cycle-85 test diffs.** Moot — stashed; upstream committed the equivalent contracts (the good half) already.
- **VER-02: stray untracked cycle-94 review copies.** Stashed; canonical complete set is committed at HEAD.
- **CRIT-02 (orphaned cycle-94 findings)** — re-dispositioned at new HEAD: the recovery run DID ledger cycle-94 (committed `_aggregate.md` + plan; C94-DES-01 fixed by `750729ad`; C94-DES-02 zoom panning carried in cycle-95 deferred; C94-11 in cycle-96 deferred). The orphan pattern is REAL but now manifests at cycle-99, tracked as C1-26.

## Cross-agent agreement highlights

- C1-01: three independent confirmations (cycle-99 architect, fd-code-reviewer at current HEAD, docs lane's ledger trace) — highest-signal actionable finding.
- C1-07: critic + perf lanes agreed independently, and the perf lane contributed the in-repo lean-count fix shape.
- C1-32: architect + critic converged on the test-ossification diagnosis from different evidence.
- C1-03: critic re-validated the 8-cycles-deferred C77-ARCH-01 from source at HEAD — still live, still High.

## Agent failures

First fan-out (12 lanes) was killed by an API session limit after 4 lanes had written artifacts
(critic, security-reviewer, test-engineer, verifier). The remaining 8 lanes were re-spawned per the
retry rule and all completed (code-reviewer, fd-code-reviewer, perf-reviewer, tracer, architect,
debugger, document-specialist, designer). No lane remains failed. Note: the 4 early lanes reviewed the
pre-fast-forward tree; their findings were re-validated against `657eb024` during aggregation (see
dispositions above; TEST-03 transferred to the committed cleanup test file, CRIT-01/02/07 and VER-02
re-dispositioned).

## Non-findings / refutations (merged)

- Security lane: no confirmed HIGH/CRITICAL security finding; auth wrappers, origin guards, upload
  path containment, OG SSRF pinning, restore subprocess hygiene, secrets handling all re-verified safe.
- Tracer: restore failure branches all keep maintenance mode (H2.2 refuted); topic-rename transaction
  still re-points all four slug stores — no new store added since R16C16; session replay hypotheses refuted.
- Verifier: 25+ load-bearing CLAUDE.md claims verified PASS except the two Very-Low doc nits (C1-27, C1-28).
- Perf: pool config, queue concurrency math, advisory-lock usage, SW cache bounds re-verified as documented.
