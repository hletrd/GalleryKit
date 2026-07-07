# Run-10 Cycle 9 (loop-B) Implementation Plan — 2026-07-08

Status: IMPLEMENTATION IN PROGRESS (WP1-5,7-9,11-13 landed; WP2 fixed by peer cycle-19 in-flight and verified at HEAD; WP6/WP10 in progress; WP14/WP15 pending)

## Shared-worktree incident log (provenance)

- `834f27ca` (authored by this loop) swept the peer cycle-19 session's STAGED
  files from the shared git index into a commit whose message describes only
  the ICC-desc fix — the shared `.git` index is a race surface; from that
  point every loop-B commit used explicit `git commit -- <paths>` pathspecs.
  The swept content was the peer's complete in-flight fixes (verified green
  before push); nothing was lost, provenance is mixed in that one commit.
- The peer session's recovery agent subsequently re-signed/re-authored two
  loop-B commits before push (`fix(cycle9b)` `8638fe63` absorbed the WP1+WP11
  worktree changes; `6bf3f6dd` re-signed the WP9 topics-test commit) and
  interleaved its own cycle-19 commits. All loop-B fix CONTENT was verified
  present at HEAD after each interleave (15-point grep check).
- AGG9B-02 (WP2) and AGG9B-19 were fixed by the peer's cycle-19 in-flight
  work (converged with this cycle's plan); verified at HEAD rather than
  re-implemented.
- AGG9B-16/AGG9B-17 were closed by the peer's cycle-19 ledger reconciliation
  (cycle-18 status + carry-forward age basis now `r10c19`); this cycle's
  WP14 remainder is the cycle-9b pair registration + name disambiguation.
Aggregate: `.context/reviews/cycle-9-2026-07-08/_aggregate.md` (28 deduped findings)
Review HEAD: `6efd737b3ad5791c662fded4801701992684e54d`
Naming: `9b` filename suffix per the 7b/8b precedent — the peer run-10 loop's own Cycle 9
artifacts (`cycle-9-2026-07-07-{plan,deferred}.md`) own the unsuffixed name space (AGG9B-20).

Repo rules read before scheduling/deferring: `CLAUDE.md`, `AGENTS.md`,
`.context/plans/README.md` (incl. carry-forward age budget + MED checkpoint),
`.context/plans/deferred-carry-forward.md`, `cycle-18-2026-07-08-{plan,deferred}.md`,
`cycle-8b-2026-07-07-{plan,deferred}.md`, `cycle-2-2026-07-07-deferred.md`. No
`.context/README.md`, `.cursorrules`, or `CONTRIBUTING.md` exists in this checkout.

SHARED-WORKTREE PROTOCOL: the peer run-10 loop's cycle-19 lanes are concurrently rewriting
the top-level `.context/reviews/*.md` files (peer-dirty — never staged/committed by this
cycle). Before EACH work package lands, re-verify against the then-current committed HEAD
that the peer has not already fixed it; `git pull --rebase` before every push; stage only
loop-B-owned files.

## Scheduled Work Packages

### WP1 — Mark PAT use only for admitted uploads (AGG9B-01, High/High, 2-lane)

Files: `apps/web/src/app/api/admin/lr/upload/route.ts`,
`apps/web/src/__tests__/lr-upload-route-behavior.test.ts`

1. Move `markAdminAuthTokenUsed(request)` from the pre-parse position (line 160) to the
   committed-success path — immediately after the image row insert succeeds, before the
   201 response — so "used" means "the route accepted an upload". The WeakSet idempotence
   guard stays.
2. Regression tests: (a) admitted path still marks exactly once (update existing),
   (b) unknown-topic 404 does NOT mark, (c) mid-request restore race — sequence
   `isRestoreMaintenanceActiveMock` `false` (entry) then `true` (post-parse re-check) —
   does NOT mark (closes the untestable-with-static-mock gap CRIT9-01 identified).

Acceptance: no rejection branch (4xx/5xx/503) updates `last_used_at`; a committed upload does.

### WP2 — CLIP backfill: stop conflating attempt budget with fetch LIMIT (AGG9B-02, Med/High, 3-lane)

Files: `apps/web/src/app/actions/embeddings.ts`,
`apps/web/scripts/backfill-clip-embeddings.ts`,
`apps/web/src/__tests__/embeddings-action-behavior.test.ts`, sidecar test file as applicable

1. In both loops, record `const fetchLimit = Math.min(BATCH_SIZE, remainingEmbeddingBudget)`
   and break on `rows.length < fetchLimit` (not `< BATCH_SIZE`). A budget-clamped full page
   then continues; skip-heavy windows keep advancing the cursor until real attempts exhaust
   the budget (which logs `Reached SEMANTIC_SCAN_LIMIT`) or a genuinely short page ends the
   table — restoring the documented operator completion contract.
2. Regression: budget clamped below batch size, boundary page all-skip rows followed by
   valid rows → run continues and processes the later valid rows.

Acceptance: the run never reports quiet completion while un-scanned candidate rows remain.

### WP3 — SW LRU: make read-decide-evict atomic (AGG9B-03, Med/Med-High)

Files: `apps/web/public/sw.template.js`, `apps/web/src/lib/sw-cache.ts`,
`apps/web/public/sw.js` (regenerated), `apps/web/src/__tests__/sw-cache.test.ts`,
`apps/web/src/__tests__/sw-template-contract.test.ts` (pin updates)

1. Fold the stale-age read, decision, `imageCache.delete`, and meta removal into ONE
   queued `withMetaMutation` callback (re-read inside the queue) in both the template and
   the reference mirror, preserving the bytes-before-meta crash ordering.
2. Regenerate `sw.js` via the build script and commit it (CLAUDE.md SW contract).
3. Add an interleaved test: a same-URL `touchMeta` landing between the old read and delete
   phases must prevent the eviction.

Acceptance: a concurrently-refreshed entry can no longer be evicted on a stale decision.

### WP4 — Reject add/remove tag overlap in bulk edit (AGG9B-04, Med/High)

Files: `apps/web/src/app/actions/images.ts` (`bulkUpdateImages`),
`apps/web/src/components/bulk-edit-dialog.tsx`, `apps/web/messages/{en,ko}.json`,
bulk-update test file

1. Server: after normalization, if `addTagNames` ∩ `removeTagNames` ≠ ∅ → validation error
   (mirrors the existing topic-mode validation pattern).
2. Client: same check in `handleSubmit` with a localized error; i18n keys in both locales
   (ko without ICU plural per DOC-R5C3-07).
3. Test: overlapping submission returns the error and performs no mutation.

### WP5 — TagFilter render-cost containment (AGG9B-05, Med/High, 2-lane)

Files: `apps/web/src/components/tag-filter.tsx`

1. `useMemo` the `chips` fragment and export the component wrapped in `React.memo` so
   scroll-append / viewport-bucket re-renders of `HomeClient` stop re-reconciling both
   copies. (The dual-mount itself is the peer's cycle-18 design for SSR-correct responsive
   split; the single-mount redesign half is recorded in the deferred register.)

### WP6 — Cross-admin PAT visibility + revocation (AGG9B-06, Med/Med — security-adjacent, not deferrable without a rule)

Files: `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/lr-tokens.ts`,
tokens admin page component, `apps/web/messages/{en,ko}.json`,
`apps/web/src/__tests__/admin-tokens.test.ts` + action tests

1. Add `listAllTokens()` (owner-labeled via join to `admin_users.username`) and allow
   revocation of any token by any admin (`revokeTokenById`), consistent with the documented
   full-trust multi-root-admin model (`deleteAdminUser` precedent).
2. Tokens page: owner column; revoke available on all rows; audit-log records actor and
   token owner.
3. Tests for cross-admin list/revoke; creation stays owner-scoped.

### WP7 — Behavior-test the restore drain-checklist orchestration (AGG9B-07, High/High)

Files: `apps/web/src/lib/restore-drain-checklist.ts` (new),
`apps/web/src/app/[locale]/admin/db-actions.ts`, new test file, existing source-contract
tests updated as needed

1. Extract the four-stage drain sequence into an injectable
   `runRestoreDrainChecklist({ stages })` returning `{ ok: true } | { ok: false, stage }`
   (pattern precedent: `computeBackfillExitCode`), called from `restoreDatabase()` with the
   real drains, preserving exact order and early-return semantics.
2. Behavior tests: each stage failing in turn stops the checklist, later stages never run,
   and the result maps to the right blocked message.

### WP8 — GPS-strip fail-closed behavior tests (AGG9B-08, High/High)

Files: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts`, possibly a new
`images-action-gps-fail-closed` behavior test

1. LR route half (cheap — the POST-handler harness already exists): mock
   `stripGpsFromOriginal` → `false` with `strip_gps_on_upload` enabled; assert the request
   is rejected, no DB insert occurs, and the saved original is deleted.
2. `uploadImages()` half: attempt the same with the server-action mocking conventions used
   by the queue/topics suites. If the dependency surface proves as heavy as the test's own
   header comment predicts, ship the LR half and record the action half in the deferred
   register chaining D8b-02's harness exit criterion (partial-completion honesty).

### WP9 — TopicRouteLockTimeoutError coverage (AGG9B-09, Med/High)

Files: `apps/web/src/__tests__/topics-actions.test.ts`

1. Add a `GET_LOCK → acquired: 0` case per action (create/update/delete topic, create/delete
   alias) asserting: correct localized error key; `deleteTopicImage` called with the
   processed cover filename for create/update; no DB mutation attempted.

### WP10 — Scanner for the admin-mutation-barrier invariant (AGG9B-12, Med/High)

Files: `apps/web/scripts/check-action-origin.ts`,
`apps/web/src/__tests__/check-action-origin.test.ts`

1. In the same AST walk that enforces `requireSameOriginAdmin()`, require mutating admin
   action exports to acquire `acquireAdminMutationSlot()` (or carry an explicit
   `@mutation-barrier-exempt: <reason>` comment; existing `@action-origin-exempt` public
   actions are barrier-exempt by the same classification).
2. Fixture tests for the new rule (positive, missing, exempted).

Acceptance: `npm run lint:action-origin` fails on a mutating admin action missing the slot.

### WP11 — UX/a11y small-fix batch (AGG9B-15 Med/High, AGG9B-23 High/High, AGG9B-24 Med/Med, AGG9B-27 Med/High, AGG9B-28 Low-Med/High)

Files: `apps/web/src/components/photo-viewer.tsx`, `info-bottom-sheet.tsx`,
`lightbox.tsx`, `image-zoom.tsx`, `image-manager.tsx`, `search.tsx`, focused tests

1. AGG9B-23: lightbox `handleTouchEnd` (and touch-start path) skips the slideshow-stop when
   the touch target is inside an interactive control (`closest('button')`) so tapping Pause
   actually pauses on touch devices.
2. AGG9B-15: `aria-pressed={isPinned}` on the desktop Info pin;
   `aria-expanded={showBottomSheet}` + `aria-controls` (new sheet root id) on the mobile
   Info trigger.
3. AGG9B-24: `touchAction: isZoomed ? 'none' : 'manipulation'` in image-zoom so the custom
   double-tap no longer races native double-tap page zoom.
4. AGG9B-28: allow Cmd/Ctrl+K to toggle-close when the focused input IS the search dialog's
   own input (ref comparison), keeping the guard for all other inputs.
5. AGG9B-27: optimistic per-row tag state in image-manager (seeded from `image.tag_names`,
   updated in `onTagsChange`, reconciled on prop change, reverted on failure).
6. Touch-target audit and i18n parity gates must stay green.

### WP12 — Correctness small-fix batch (AGG9B-21 Med/High, AGG9B-22 Med/Med-High, AGG9B-26 Med/High, AGG9B-19 Low/High)

Files: `apps/web/src/lib/restore-maintenance.ts`, `restore-maintenance-durable.ts`,
`apps/web/src/lib/rate-limit.ts` + `apps/web/src/__tests__/rate-limit.test.ts` + `CLAUDE.md`
hop row, `apps/web/src/lib/color-detection.ts` + test, `apps/web/src/lib/process-image.ts`
(comment), matching unit tests

1. AGG9B-21: `beginRestoreMaintenance` returns an owned/joined discriminant (or the durable
   wrapper checks prior state); the marker-write-failure rollback only clears the flag when
   this call newly set it. Unit test for the allowExisting + write-throw path.
2. AGG9B-22: fix XFF client selection to `validParts[length - hopCount]` with a
   `length < hopCount`... guard (chain must be strictly longer than the trusted proxy count
   minus the client slot); update the code comment, the pinned tests, and the CLAUDE.md
   `TRUSTED_PROXY_HOPS` row in one commit. Both documented topologies (shipped overwrite,
   CDN append) resolve to the true client after the fix; verify with explicit test cases
   for both, plus the attacker-prepended-entry case.
3. AGG9B-26: wire the ICC descriptor into `inferTransferFunction`'s desc checks (the call
   site's `iccName` IS the extracted descriptor — run both the raw-lowercase desc checks and
   the normalized-name checks over it); tests for "SMPTE 2084"/"Hybrid Log-Gamma"
   description-style hints; correct the header comment if any residual gap remains.
4. AGG9B-19: reword the `saveOriginalAndGetMetadata` comment — it avoids an ADDITIONAL
   copy; framework multipart parsing remains the outer memory boundary.

### WP13 — Design-debt decisions (AGG9B-13 Low-Med/High, AGG9B-14 Low/Med-High)

Files: `apps/web/src/lib/action-result.ts` (delete),
`apps/web/src/lib/pending-session-revocations.ts`

1. AGG9B-13: delete the zero-consumer `ActionResult<T>` dead contract (adopt-or-delete
   decision: delete; the de facto `status`-discriminant convention is recorded in the
   commit body and the aggregate).
2. AGG9B-14: apply the `globalThis + Symbol.for('gallerykit.*')` reinstantiation guard to
   the pending-revocations `Set`, matching its six siblings; existing tests stay green.

### WP14 — Ledger/provenance batch (AGG9B-16 Med/High 2-lane, AGG9B-17 Low-Med/High, AGG9B-18 Low-Med/High, AGG9B-20 Low/High)

Files: `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`,
`.context/plans/cycle-18-2026-07-08-plan.md` (only if the peer has not already finalized it)

1. Index the cycle-9b pair as loop-B's active plan; move cycle-8b to Recently Completed.
2. Add historical-disambiguation notes for the THREE Cycle 9 lineages and the old
   root-level `cycle-19-{plan,deferred}.md` files (annotate in the index; no renames while
   the peer is mid-cycle).
3. Refresh the carry-forward register age-basis label (peer-conflict-aware; rebase on
   collision).
4. After this cycle's deploy: record deploy evidence here, and if the peer's own cycle-19
   has not already reconciled the cycle-18 plan status line, annotate it as
   committed+pushed with deploy superseded by this cycle's transcript.

### WP15 — Gates, commit/push, per-cycle deploy

1. Run all 8 gates repo-wide: eslint, typecheck, vitest unit, build, lint:api-auth,
   lint:action-origin, lint:public-route-rate-limit, and the final Playwright e2e run
   SYNCHRONOUSLY in the orchestrating shell.
2. Fix error-level gate failures before commit (no suppressions); check `git status`
   ownership before attributing any failure to peer-dirty files.
3. Fine-grained GPG-signed Conventional Commits with gitmoji; `git pull --rebase` before
   every push; stage only loop-B-owned files (never `git add -A`).
4. `DEPLOY_MODE=per-cycle`: check `ps aux | grep "npm run deploy"` for a peer deploy in
   flight, then run `npm run deploy` once from the repo root; one clean re-run allowed on a
   docker container-name conflict. Record the outcome here.

## Progress

- [x] WP1 PAT mark-on-committed-upload (landed via `58527c20`, absorbed into `8638fe63` by the peer recovery re-sign; content verified at HEAD)
- [x] WP2 CLIP backfill boundary — fixed by peer cycle-19 in-flight (`834f27ca` sweep committed it); verified at HEAD, not re-implemented
- [x] WP3 SW LRU atomic eviction (`2e902774`, sw.js regenerated version 2bd9e8ba-p7)
- [x] WP4 bulk-edit tag overlap (`4a55fc3b` + peer convergence `b0d1f0f2`)
- [x] WP5 TagFilter memoization (`013dcc56`)
- [ ] WP6 cross-admin PAT revocation
- [x] WP7 restore drain-checklist orchestrator (`1ebf5cf7`)
- [x] WP8 GPS fail-closed behavior tests — LR half landed with WP1; uploadImages half recorded as conditional deferral D9b-05
- [x] WP9 topic lock-timeout coverage (`95ac2358`, re-signed as `6bf3f6dd`)
- [ ] WP10 mutation-barrier scanner
- [x] WP11 UX/a11y batch (`fa15ba12`, absorbed into `8638fe63`)
- [x] WP12 correctness batch — rate-limit XFF (`40233ea4`), ICC desc wiring (`834f27ca`), restore-maintenance owned rollback (`4bf90ae8`); AGG9B-19 comment fixed by peer cycle-19
- [x] WP13 design-debt decisions (`2a019980`, `ca6044b6`)
- [ ] WP14 ledger/provenance batch (README + gitignore + this plan's status — this commit; AGG9B-16/17 halves closed by peer cycle-19)
- [ ] WP15 gates + commit/push + deploy
